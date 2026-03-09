const express = require('express');
const { execFile, spawn } = require('child_process');
const util = require('util');
const { WebSocketServer } = require('ws');
const snapshotK8s = require('../utils/snapshot-handler');

const execFileAsync = util.promisify(execFile);

const router = express.Router();

global.runningProcesses = global.runningProcesses || new Map();

// Strip shell quotes from a single arg token: 'foo' → foo, "foo" → foo
function stripQuotes(arg) {
  return arg.replace(/^(['"])(.*)\1$/, '$2');
}

// Split command string into args array, stripping shell quotes from each token
function parseArgs(command) {
  return command.split(/\s+/).slice(1).map(stripQuotes);
}

// Split kubectl get all output into separate tables
function splitGetAllTables(output) {
  const lines = output.split('\n');
  const tables = [];
  let currentTable = null;

  const isAllNamespaces = output.includes('NAMESPACE');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '') {
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    const isHeaderLine = isAllNamespaces ?
      line.startsWith('NAMESPACE') :
      line.startsWith('NAME');

    if (isHeaderLine) {
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
      }
      currentTable = {
        resourceType: 'Unknown',
        lines: [line],
        resourceTypeDetected: false
      };
      continue;
    }

    if (currentTable && line.trim()) {
      if (!currentTable.resourceTypeDetected) {
        const parts = line.trim().split(/\s+/);
        const resourceNameIndex = isAllNamespaces ? 1 : 0;

        if (parts.length > resourceNameIndex) {
          const resourceName = parts[resourceNameIndex];
          let resourceType = 'Resources';

          if (resourceName.includes('/')) {
            const resourcePrefix = resourceName.split('/')[0];
            switch (resourcePrefix.toLowerCase()) {
              case 'deployment.apps': resourceType = 'DEPLOYMENT'; break;
              case 'replicaset.apps': resourceType = 'REPLICASET'; break;
              case 'statefulset.apps': resourceType = 'STATEFULSET'; break;
              case 'daemonset.apps': resourceType = 'DAEMONSET'; break;
              case 'pod': resourceType = 'POD'; break;
              case 'service': resourceType = 'SERVICE'; break;
              case 'horizontalpodautoscaler.autoscaling': resourceType = 'HPA'; break;
              case 'cronjob.batch': resourceType = 'CRONJOB'; break;
              case 'job.batch': resourceType = 'JOB'; break;
              default: resourceType = resourcePrefix.split('.')[0].toUpperCase(); break;
            }
          }
          currentTable.resourceType = resourceType;
          currentTable.resourceTypeDetected = true;
        }
      }
      currentTable.lines.push(line);
    }
  }

  if (currentTable && currentTable.lines.length > 1) {
    tables.push(currentTable);
  }

  let result = '';
  tables.forEach((table, index) => {
    if (index > 0) result += '\n\n';
    result += `=== ${table.resourceType} ===\n`;
    result += table.lines.join('\n');
  });

  return result;
}

// POST /api/execute
router.post('/execute', async (req, res) => {
  const { command } = req.body;

  if (!command || !command.startsWith('kubectl')) {
    return res.status(400).json({
      error: 'Only kubectl commands are allowed',
      success: false
    });
  }

  if (req.query.snapshot === 'true') {
    console.log(`[SNAPSHOT] Intercepting: ${command}`);
    const result = snapshotK8s.handleCommand(command);
    return res.json({
      success: result.success,
      stdout: result.stdout || '',
      error: result.error || undefined,
      command: command
    });
  }

  // Parse "kubectl <args...>" into execFile arguments
  const args = parseArgs(command);

  console.log(`Executing: ${command}`);

  try {
    const { stdout } = await execFileAsync('kubectl', args, { timeout: 30000 });

    let processedOutput = stdout;
    if (command.includes('get all')) {
      processedOutput = splitGetAllTables(stdout);
    }

    res.json({
      success: true,
      stdout: processedOutput,
      command: command
    });
  } catch (error) {
    // execFile rejects with error.stderr and error.stdout on non-zero exit
    const errorMessage = (error.stderr || error.stdout || '').trim() || error.message;
    res.json({
      success: false,
      error: errorMessage,
      stdout: '',
      command: command
    });
  }
});

// POST /api/execute/stream/stop
router.post('/execute/stream/stop', (req, res) => {
  const { streamId } = req.body;
  if (!streamId) {
    return res.status(400).json({ error: 'streamId is required' });
  }
  const entry = global.runningProcesses?.get(streamId);
  if (entry) {
    entry.process.kill('SIGTERM');
    global.runningProcesses.delete(streamId);
    console.log(`Terminated stream: ${streamId}`);
    res.json({ success: true, message: 'Stream terminated' });
  } else {
    res.status(404).json({ error: 'Stream not found' });
  }
});

// POST /api/execute/stream/clear
router.post('/execute/stream/clear', (req, res) => {
  const { streamId } = req.body;
  const entry = global.runningProcesses?.get(streamId);
  if (entry) entry.bufferRef.value = '';
  res.json({ success: true });
});

// Attach WebSocket server to the HTTP server for /api/execute/stream/ws
function mountWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/api/execute/stream/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Other paths (e.g. webpack HMR) are left alone
  });

  wss.on('connection', (ws) => {
    // First message from client: { command, streamId, snapshot }
    ws.once('message', (raw) => {
      let init;
      try {
        init = JSON.parse(raw.toString());
      } catch {
        ws.close();
        return;
      }

      const { command, streamId, snapshot } = init;
      if (!command || !streamId) {
        sendWs(ws, { type: 'stream-error', streamId: streamId || '', error: 'command and streamId are required' });
        ws.close();
        return;
      }

      console.log(`[stream] start ${command} (id=${streamId} snapshot=${!!snapshot})`);

      // Snapshot mode — fake the stream
      if (snapshot) {
        const result = snapshotK8s.handleCommand(command);
        const output = result.stdout || result.error || '';
        setTimeout(() => {
          sendWs(ws, { type: 'stream-data', streamId, dataType: 'stdout', data: output, timestamp: Date.now() });
          setTimeout(() => {
            sendWs(ws, { type: 'stream-end', streamId, exitCode: result.success ? 0 : 1, fullOutput: output, timestamp: Date.now() });
            ws.close();
          }, 500);
        }, 300);
        return;
      }

      // Realtime mode — spawn kubectl
      const args = parseArgs(command);
      const proc = spawn('kubectl', args);
      const bufferRef = { value: '' };
      global.runningProcesses.set(streamId, { process: proc, bufferRef });

      const cleanup = () => {
        if (proc.exitCode === null) proc.kill('SIGTERM');
        global.runningProcesses.delete(streamId);
      };

      ws.on('close', cleanup);

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        bufferRef.value += chunk;
        sendWs(ws, { type: 'stream-data', streamId, dataType: 'stdout', data: chunk, timestamp: Date.now() });
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        bufferRef.value += chunk;
        sendWs(ws, { type: 'stream-data', streamId, dataType: 'stderr', data: chunk, timestamp: Date.now() });
      });

      proc.on('close', (code) => {
        console.log(`[stream] end ${command} (id=${streamId} exit=${code})`);
        sendWs(ws, { type: 'stream-end', streamId, exitCode: code, fullOutput: bufferRef.value, timestamp: Date.now() });
        global.runningProcesses.delete(streamId);
        ws.close();
      });

      proc.on('error', (err) => {
        console.error(`[stream] error ${streamId}:`, err);
        sendWs(ws, { type: 'stream-error', streamId, error: err.message, timestamp: Date.now() });
        global.runningProcesses.delete(streamId);
        ws.close();
      });
    });
  });
}

function sendWs(ws, data) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(data));
  }
}

module.exports = { router, mountWebSocket };
