const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// GET /api/health
router.get('/health', (req, res) => {
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

// GET /api/snapshot-status
router.get('/snapshot-status', (req, res) => {
  const backupDir = path.join(__dirname, '..', 'k8s-snapshot');
  let available = false;

  try {
    if (fs.existsSync(backupDir)) {
      const entries = fs.readdirSync(backupDir);
      available = entries.some(e => {
        const full = path.join(backupDir, e);
        return fs.statSync(full).isDirectory() && !e.startsWith('.');
      });
    }
  } catch (e) {
    // directory doesn't exist or can't be read
  }

  res.json({ available });
});

module.exports = router;
