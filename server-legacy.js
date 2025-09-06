const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(cors({
  origin: 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());

// Function to split kubectl get all --all-namespaces output into separate tables
function splitGetAllTables(output) {
  const lines = output.split('\n');
  const tables = [];
  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip completely empty lines
    if (line.trim() === '') {
      // Empty line might indicate end of current table
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    // Check if this is a header line (starts with NAMESPACE)
    if (line.startsWith('NAMESPACE')) {
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
        if (parts.length >= 2) {
          const resourceName = parts[1]; // e.g., "replicaset.apps/dashboard-ui-85f85b8964"
          let resourceType = 'Resources';

          if (resourceName.includes('/')) {
            const resourcePrefix = resourceName.split('/')[0];
            // Map resource prefixes to friendly names (avoid spaces in names)
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

          // Customize the header - ensure NAMESPACE is first, then {RESOURCE}_NAME
          const headerLine = currentTable.lines[0];
          // The original header format should be "NAMESPACE NAME ..." 
          // We want to change it to "NAMESPACE {RESOURCE}_NAME ..."
          const newHeader = headerLine.replace(/^(\w+\s+)NAME/, `$1${resourceType}_NAME`);
          currentTable.lines[0] = newHeader;

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

  // 動態產生暫存檔路徑
  const tempFile = path.join(os.tmpdir(), `kubectl-${uuidv4()}.txt`);
  const fullCommand = `${command} > ${tempFile} 2>&1`;

  console.log(`Executing: ${fullCommand}`);

  exec(fullCommand, { timeout: 30000 }, (error) => {
    // 無論成功或失敗，讀取 tempFile
    fs.readFile(tempFile, 'utf8', (readErr, data) => {
      // 清理檔案
      fs.unlink(tempFile, () => { });

      if (readErr) {
        return res.status(500).json({
          success: false,
          error: 'Failed to read command output file',
          file: tempFile
        });
      }

      if (error) {
        return res.json({
          success: false,
          error: error.message,
          stdout: data,
          command: command
        });
      }

      // Check if this is "kubectl get all --all-namespaces" and split tables
      let processedOutput = data;
      if (command.includes('get all --all-namespaces')) {
        processedOutput = splitGetAllTables(data);
      }

      res.json({
        success: true,
        stdout: processedOutput,
        command: command
      });
    });
  });
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

app.listen(PORT, () => {
  console.log(`🚀 kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
});