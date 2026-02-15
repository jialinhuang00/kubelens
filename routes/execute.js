const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const mockK8s = require('../mock-k8s');

const router = express.Router();

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
router.post('/execute', (req, res) => {
  const { command } = req.body;

  if (!command || !command.startsWith('kubectl')) {
    return res.status(400).json({
      error: 'Only kubectl commands are allowed',
      success: false
    });
  }

  if (req.query.mock === 'true') {
    console.log(`[MOCK] Intercepting: ${command}`);
    const result = mockK8s.handleCommand(command);
    return res.json({
      success: result.success,
      stdout: result.stdout || '',
      error: result.error || undefined,
      command: command
    });
  }

  const tempFile = path.join(os.tmpdir(), `kubectl-${uuidv4()}.txt`);
  const fullCommand = `${command} > ${tempFile} 2>&1`;

  console.log(`Executing: ${command}`);

  setTimeout(() => {
    exec(fullCommand, { timeout: 30000 }, (error) => {
      fs.readFile(tempFile, 'utf8', (readErr, data) => {
        fs.unlink(tempFile, () => { });

        if (readErr) {
          return res.status(500).json({
            success: false,
            error: 'Failed to read command output file',
            file: tempFile
          });
        }

        if (error) {
          const actualErrorMessage = data.trim() || error.message;
          return res.json({
            success: false,
            error: actualErrorMessage,
            stdout: '',
            command: command
          });
        }

        let processedOutput = data;
        if (command.includes('get all')) {
          processedOutput = splitGetAllTables(data);
        }

        res.json({
          success: true,
          stdout: processedOutput,
          command: command
        });
      });
    });
  }, 3000);
});

// POST /api/execute/stream — needs io passed in
function mountStream(router, io) {
  router.post('/execute/stream', (req, res) => {
    const { command, streamId } = req.body;

    if (req.query.mock === 'true') {
      console.log(`[MOCK] Stream intercepting: ${command}`);
      const result = mockK8s.handleCommand(command);
      res.json({ success: true, message: 'Stream started (mock)', streamId });
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

    const args = command.split(' ').slice(1);
    const kubectlProcess = spawn('kubectl', args);

    global.runningProcesses = global.runningProcesses || new Map();
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
