const express = require('express');
const { exec, spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200",
    methods: ["GET", "POST"]
  }
});
const PORT = 3000;

app.use(cors({
  origin: 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());

// Function to split kubectl get all output into separate tables
function splitGetAllTables(output) {
  const lines = output.split('\n');
  const tables = [];
  let currentTable = null;

  // Check if this is --all-namespaces output (has NAMESPACE column)
  const isAllNamespaces = output.includes('NAMESPACE');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip completely empty lines
    if (line.trim() === '') {
      // Empty line indicates end of current table
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    // Check if this is a header line
    const isHeaderLine = isAllNamespaces ?
      line.startsWith('NAMESPACE') :
      line.startsWith('NAME');

    if (isHeaderLine) {
      // If we have a current table, save it first
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
      }

      // Start new table
      currentTable = {
        resourceType: 'Unknown',
        lines: [line],
        resourceTypeDetected: false
      };
      continue;
    }

    // This is a data line
    if (currentTable && line.trim()) {
      // If this is the first data line, detect resource type
      if (!currentTable.resourceTypeDetected) {
        const parts = line.trim().split(/\s+/);
        const resourceNameIndex = isAllNamespaces ? 1 : 0; // NAMESPACE NAME vs NAME

        if (parts.length > resourceNameIndex) {
          const resourceName = parts[resourceNameIndex];
          let resourceType = 'Resources';

          if (resourceName.includes('/')) {
            const resourcePrefix = resourceName.split('/')[0];
            switch (resourcePrefix.toLowerCase()) {
              case 'deployment.apps':
                resourceType = 'DEPLOYMENT';
                break;
              case 'replicaset.apps':
                resourceType = 'REPLICASET';
                break;
              case 'statefulset.apps':
                resourceType = 'STATEFULSET';
                break;
              case 'daemonset.apps':
                resourceType = 'DAEMONSET';
                break;
              case 'pod':
                resourceType = 'POD';
                break;
              case 'service':
                resourceType = 'SERVICE';
                break;
              case 'horizontalpodautoscaler.autoscaling':
                resourceType = 'HPA';
                break;
              case 'cronjob.batch':
                resourceType = 'CRONJOB';
                break;
              case 'job.batch':
                resourceType = 'JOB';
                break;
              default:
                // Try to make a reasonable name from the prefix
                resourceType = resourcePrefix.split('.')[0].toUpperCase();
                break;
            }
          }

          currentTable.resourceType = resourceType;
          currentTable.resourceTypeDetected = true;
        }
      }

      // Add the data line
      currentTable.lines.push(line);
    }
  }

  // Add the last table if exists
  if (currentTable && currentTable.lines.length > 1) {
    tables.push(currentTable);
  }

  // Format output with table titles
  let result = '';
  tables.forEach((table, index) => {
    if (index > 0) {
      result += '\n\n';
    }
    result += `=== ${table.resourceType} ===\n`;
    result += table.lines.join('\n');
  });

  return result;
}

// Execute kubectl commands
app.post('/api/execute', (req, res) => {
  const { command } = req.body;

  if (!command || !command.startsWith('kubectl')) {
    return res.status(400).json({
      error: 'Only kubectl commands are allowed',
      success: false
    });
  }

  // dynamically create tempFile
  const tempFile = path.join(os.tmpdir(), `kubectl-${uuidv4()}.txt`);
  const fullCommand = `${command} > ${tempFile} 2>&1`;

  console.log(`Executing: ${fullCommand}`);

  // Simulate slow command for testing
  exec(fullCommand, { timeout: 30000 }, (error) => {
    // read tempFile no matter success or fail.
    fs.readFile(tempFile, 'utf8', (readErr, data) => {
      // rm temp file
      fs.unlink(tempFile, () => { });

      if (readErr) {
        return res.status(500).json({
          success: false,
          error: 'Failed to read command output file',
          file: tempFile
        });
      }

      if (error) {
        // When kubectl command fails, show the actual error message from the output
        // instead of just the generic exec error message
        const actualErrorMessage = data.trim() || error.message;
        return res.json({
          success: false,
          error: actualErrorMessage,
          stdout: '', // no ambiguous here, frontend only see error.
          command: command
        });
      }

      // Check if this is "kubectl get all" and split tables  
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
  })
});

// Health check
app.get('/api/health', (req, res) => {
  exec('which kubectl && kubectl version --client -o json', (error, stdout, stderr) => {
    const env_info = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      KUBECONFIG: process.env.KUBECONFIG,
      working_directory: process.cwd()
    };

    if (error) {
      return res.json({
        status: 'kubectl not available',
        error: error.message,
        environment: env_info,
        stderr: stderr
      });
    }

    const lines = stdout.split('\n');
    const kubectlPath = lines[0];
    const versionJson = lines.slice(1).join('\n');

    try {
      const version = JSON.parse(versionJson);
      res.json({
        status: 'healthy',
        kubectl: {
          path: kubectlPath,
          version: version.clientVersion?.gitVersion || 'unknown'
        },
        environment: env_info
      });
    } catch (e) {
      res.json({
        status: 'kubectl found but version parse failed',
        kubectl_path: kubectlPath,
        environment: env_info,
        raw_output: versionJson
      });
    }
  });
});

// 串流執行 kubectl 指令 (用於長時間運行的指令如 rollout status)
app.post('/api/execute/stream', (req, res) => {
  const { command, streamId } = req.body;

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

  // start response, the streaming is starting.
  res.json({
    success: true,
    message: 'Stream started',
    streamId: streamId
  });

  // parse command and option
  const args = command.split(' ').slice(1); // rm 'kubectl'

  // using spawn for executing command, then getting realtime output
  const kubectlProcess = spawn('kubectl', args);

  // save process ref, for stopping later
  global.runningProcesses = global.runningProcesses || new Map();
  global.runningProcesses.set(streamId, kubectlProcess);

  let outputBuffer = '';

  // processing stdout
  kubectlProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    outputBuffer += chunk;

    // send realtime data to frontend
    io.emit('stream-data', {
      streamId: streamId,
      type: 'stdout',
      data: chunk,
      timestamp: Date.now()
    });
  });

  // processing stderr
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

  // process is over
  kubectlProcess.on('close', (code) => {
    console.log(`Stream ${streamId} closed with code: ${code}`);

    io.emit('stream-end', {
      streamId: streamId,
      exitCode: code,
      fullOutput: outputBuffer,
      timestamp: Date.now()
    });

    // rm process ref
    global.runningProcesses.delete(streamId);
  });

  // process has error
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

// stop streaming
app.post('/api/execute/stream/stop', (req, res) => {
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

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔌 WebSocket server ready for streaming`);
});