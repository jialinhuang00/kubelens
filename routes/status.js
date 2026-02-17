const express = require('express');
const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const execFileAsync = util.promisify(execFile);

const router = express.Router();

// GET /api/realtime/ping
router.get('/realtime/ping', async (req, res) => {
  const env_info = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    KUBECONFIG: process.env.KUBECONFIG,
    working_directory: process.cwd()
  };

  try {
    const { stdout: whichOut } = await execFileAsync('which', ['kubectl']);
    const kubectlPath = whichOut.trim();

    const { stdout: versionOut } = await execFileAsync('kubectl', ['version', '--client', '-o', 'json']);

    try {
      const version = JSON.parse(versionOut);
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
        raw_output: versionOut
      });
    }
  } catch (error) {
    res.json({
      status: 'kubectl not available',
      error: error.message,
      environment: env_info,
      stderr: error.stderr || ''
    });
  }
});

// GET /api/snapshot/ping
router.get('/snapshot/ping', async (req, res) => {
  const backupDir = path.join(__dirname, '..', 'k8s-snapshot');
  let available = false;

  try {
    await fsp.access(path.join(backupDir, '.export-complete'));
    available = true;
  } catch {
    // .export-complete doesn't exist — no complete snapshot
  }

  res.json({ available });
});

module.exports = router;
