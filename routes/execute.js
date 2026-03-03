const express = require('express');
const { execFile, spawn } = require('child_process');
const util = require('util');
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

// POST /api/execute/stream — needs io passed in
function mountStream(router, io) {
  router.post('/execute/stream', (req, res) => {
    const { command, streamId } = req.body;

    if (req.query.snapshot === 'true') {
      console.log(`[SNAPSHOT] Stream intercepting: ${command}`);
      const result = snapshotK8s.handleCommand(command);
      res.json({ success: true, message: 'Stream started (snapshot)', streamId });
      setTimeout(() => {
        io.emit('stream-data', { streamId, type: 'stdout', data: result.stdout || result.error || '', timestamp: Date.now() });
        setTimeout(() => {
          io.emit('stream-end', { streamId, exitCode: result.success ? 0 : 1, fullOutput: result.stdout || result.error || '', timestamp: Date.now() });
        }, 500);
      }, 300);
      return;
    }

    if (!command || !command.startsWith('kubectl')) {
      return res.status(400).json({
        error: 'Only kubectl commands are allowed',
        success: false
      });
    }

    if (!streamId) {
      return res.status(400).json({
        error: 'streamId is required for streaming commands',
        success: false
      });
    }

    console.log(`Starting stream for: ${command} (ID: ${streamId})`);

    res.json({
      success: true,
      message: 'Stream started',
      streamId: streamId
    });

    const args = parseArgs(command);
    const kubectlProcess = spawn('kubectl', args);

    global.runningProcesses.set(streamId, kubectlProcess);

    let outputBuffer = '';

    kubectlProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      outputBuffer += chunk;
      io.emit('stream-data', {
        streamId: streamId,
        type: 'stdout',
        data: chunk,
        timestamp: Date.now()
      });
    });

    kubectlProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      outputBuffer += chunk;
      io.emit('stream-data', {
        streamId: streamId,
        type: 'stderr',
        data: chunk,
        timestamp: Date.now()
      });
    });

    kubectlProcess.on('close', (code) => {
      console.log(`Stream ${streamId} closed with code: ${code}`);
      io.emit('stream-end', {
        streamId: streamId,
        exitCode: code,
        fullOutput: outputBuffer,
        timestamp: Date.now()
      });
      global.runningProcesses.delete(streamId);
    });

    kubectlProcess.on('error', (error) => {
      console.error(`Stream ${streamId} error:`, error);
      io.emit('stream-error', {
        streamId: streamId,
        error: error.message,
        timestamp: Date.now()
      });
      global.runningProcesses.delete(streamId);
    });
  });

  // POST /api/execute/stream/stop
  router.post('/execute/stream/stop', (req, res) => {
    const { streamId } = req.body;

    if (!streamId) {
      return res.status(400).json({ error: 'streamId is required' });
    }

    const process = global.runningProcesses?.get(streamId);
    if (process) {
      process.kill('SIGTERM');
      global.runningProcesses.delete(streamId);
      console.log(`Terminated stream: ${streamId}`);
      res.json({ success: true, message: 'Stream terminated' });
    } else {
      res.status(404).json({ error: 'Stream not found' });
    }
  });
}

module.exports = { router, mountStream };
