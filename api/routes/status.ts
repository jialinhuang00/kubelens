import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { promises as fsp } from 'fs';

import { snapshotDir } from '../utils/paths';

const execFileAsync = promisify(execFile);

const router = express.Router();

/** A failed execFile carries the child's output on the error object. */
interface ExecError extends Error {
  stderr?: string;
}

// GET /api/realtime/ping
router.get('/realtime/ping', async (req: Request, res: Response) => {
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
    } catch {
      res.json({
        status: 'kubectl found but version parse failed',
        kubectl_path: kubectlPath,
        environment: env_info,
        raw_output: versionOut
      });
    }
  } catch (err) {
    const error = err as ExecError;
    res.json({
      status: 'kubectl not available',
      error: error.message,
      environment: env_info,
      stderr: error.stderr || ''
    });
  }
});

// GET /api/export/ping
router.get('/export/ping', async (req: Request, res: Response) => {
  try {
    await execFileAsync('which', ['parallel']);
    res.json({ parallel: true });
  } catch {
    res.json({ parallel: false });
  }
});

// GET /api/snapshot/ping
router.get('/snapshot/ping', async (req: Request, res: Response) => {
  // Same directory the export writes to and the loader reads from. Resolving
  // this separately is what let the toggle report a snapshot that the export
  // route had never written to.
  const backupDir = snapshotDir();
  let available = false;

  try {
    await fsp.access(path.join(backupDir, '.export-complete'));
    available = true;
  } catch {
    // .export-complete doesn't exist — no complete snapshot
  }

  res.json({ available });
});

export = router;
