const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const router = express.Router();

const snapshotDir = path.join(__dirname, '../..', 'k8s-snapshot');

let exportState = {
  running: false,
  paused: false,
  pid: null,
  startedAt: null,
  totalNamespaces: 0,
  completedNamespaces: 0,
  activeNamespaces: new Set(),
  activeResources: new Set(),
  fileCount: 0,
  minEtaSeconds: null,
  error: null,
  output: '',
};

async function countFiles(dir) {
  let count = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += await countFiles(full);
      } else {
        count++;
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return count;
}

async function countDoneNamespaces() {
  try {
    const entries = await fsp.readdir(snapshotDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await fsp.access(path.join(snapshotDir, entry.name, '.done'));
        count++;
      } catch { /* no .done marker */ }
    }
    return count;
  } catch {
    return 0;
  }
}

// POST /api/k8s-export/start
router.post('/k8s-export/start', (req, res) => {
  if (exportState.running) {
    return res.status(409).json({ error: 'Export already running' });
  }

  const resume = req.body?.resume === true;

  exportState = {
    running: true,
    paused: false,
    pid: null,
    startedAt: Date.now(),
    totalNamespaces: 0,
    completedNamespaces: 0,
    activeNamespaces: new Set(),
    activeResources: new Set(),
    fileCount: 0,
    error: null,
    output: '',
  };

  const useGo = process.env.USE_GO_EXPORT === 'true';
  const scriptPath = useGo
    ? path.join(__dirname, '../..', 'cmd', 'k8s-export', 'k8s-export')
    : path.join(__dirname, '../..', 'scripts', 'k8s-export.sh');

  let spawnCmd, args;
  if (useGo) {
    spawnCmd = scriptPath;
    args = [];
  } else {
    spawnCmd = 'bash';
    args = [scriptPath];
  }
  if (resume) args.push('--resume');

  const child = spawn(spawnCmd, args, {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env },
    detached: true,  // new process group — enables group kill on pause
  });

  exportState.pid = child.pid;

  child.stdout.on('data', (data) => {
    const raw = data.toString();
    process.stdout.write(raw);
    const text = raw.replace(/\x1b\[[0-9;]*m/g, '');
    // Cap output buffer to prevent memory bloat on long exports
    if (exportState.output.length < 200000) {
      exportState.output += text;
    }

    // Parse "Discovered N namespaces"
    const discoveredMatch = text.match(/Discovered (\d+) namespaces/);
    if (discoveredMatch) {
      exportState.totalNamespaces = parseInt(discoveredMatch[1], 10);
    }

    // Parse "=== Namespace: xxx === (complete, skipping)" — already done
    const skipMatches = text.matchAll(/=== Namespace: (.+?) === \(complete, skipping\)/g);
    const skippedSet = new Set();
    for (const m of skipMatches) {
      exportState.completedNamespaces++;
      skippedSet.add(m[1]);
    }

    // Parse "=== Namespace: xxx ===" — active export (not skipped)
    const nsMatches = text.matchAll(/=== Namespace: (\S+?) ===/g);
    for (const m of nsMatches) {
      if (!skippedSet.has(m[1])) {
        exportState.activeNamespaces.add(m[1]);
      }
    }

    // Parse "✓ Namespace xxx completed" — remove from active set
    const doneNsMatches = text.matchAll(/✓ Namespace (\S+) completed/g);
    for (const m of doneNsMatches) {
      exportState.activeNamespaces.delete(m[1]);
    }

    // Parse "→ fetching xxx" — resource/batch started downloading
    const fetchMatches = text.matchAll(/→ fetching (\S+)/gm);
    for (const m of fetchMatches) {
      for (const r of m[1].split(',')) {
        exportState.activeResources.add(r);
      }
    }

    // Parse "← xxx done" / "← xxx failed" — remove from active
    const doneResMatches = text.matchAll(/← (\S+) (?:done|failed)/gm);
    for (const m of doneResMatches) {
      for (const r of m[1].split(',')) {
        exportState.activeResources.delete(r);
      }
    }
  });

  child.stderr.on('data', (data) => {
    exportState.output += data.toString();
  });

  child.on('close', (code) => {
    exportState.running = false;
    exportState.pid = null;
    countFiles(snapshotDir).then(c => { exportState.fileCount = c; });
    if (code !== 0 && !exportState.paused) {
      exportState.error = `Process exited with code ${code}`;
    }
  });

  child.on('error', (err) => {
    exportState.running = false;
    exportState.pid = null;
    exportState.error = err.message;
  });

  res.json({ started: true, pid: child.pid, resume });
});

// GET /api/k8s-export/progress
router.get('/k8s-export/progress', async (req, res) => {
  const [liveCount, doneNs, hasCompleteMarker] = await Promise.all([
    countFiles(snapshotDir),
    countDoneNamespaces(),
    fsp.access(path.join(snapshotDir, '.export-complete')).then(() => true).catch(() => false),
  ]);

  // Derive totalNamespaces: prefer in-memory (from stdout parsing), fallback to filesystem
  let totalNamespaces = exportState.totalNamespaces;
  if (!totalNamespaces && doneNs > 0) {
    // Server restarted or stdout wasn't parsed — count namespace dirs as total
    try {
      const entries = await fsp.readdir(snapshotDir, { withFileTypes: true });
      totalNamespaces = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch { /* ignore */ }
  }

  // Determine paused vs done when not running
  let paused = exportState.paused;
  if (!exportState.running && !exportState.paused) {
    if (hasCompleteMarker) {
      // .export-complete exists → export finished successfully
      paused = false;
    } else if (liveCount > 0) {
      // Files exist but no completion marker → partial/interrupted
      paused = true;
    }
  }

  // ETA: elapsed / doneNs * remainingNs — clamped to only decrease
  let etaSeconds = null;
  if (exportState.running && exportState.startedAt && doneNs > 0 && totalNamespaces > 0) {
    const elapsed = (Date.now() - exportState.startedAt) / 1000;
    const avgPerNs = elapsed / doneNs;
    const remaining = totalNamespaces - doneNs;
    const rawEta = Math.round(avgPerNs * remaining);
    // Clamp: ETA can only decrease, never jump upward
    if (exportState.minEtaSeconds === null || rawEta < exportState.minEtaSeconds) {
      exportState.minEtaSeconds = rawEta;
    }
    etaSeconds = exportState.minEtaSeconds;
  }

  const activeNsList = [...exportState.activeNamespaces];
  const response = {
    running: exportState.running,
    paused,
    totalNamespaces,
    completedNamespaces: doneNs,
    currentNamespace: activeNsList.join(', '),
    activeResources: [...exportState.activeResources],
    fileCount: liveCount,
    etaSeconds,
    error: exportState.error,
  };

  res.json(response);
});

// POST /api/k8s-export/stop — used for both pause and hard stop
router.post('/k8s-export/stop', (req, res) => {
  if (!exportState.running || !exportState.pid) {
    return res.status(400).json({ error: 'No export running' });
  }

  try {
    process.kill(-exportState.pid, 'SIGTERM');  // negative = kill entire process group
    exportState.running = false;
    exportState.paused = true;
    res.json({ stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
