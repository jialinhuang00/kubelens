const express = require('express');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const router = express.Router();

const { PKG_ROOT, resolveDataPath } = require('../utils/paths');

// Where snapshots are read from and written to. The export child runs with this
// directory's parent as its cwd, so the scripts' relative 'k8s-snapshot' lands
// in the same place the loader reads from.
const snapshotDir = resolveDataPath('k8s-snapshot');
const snapshotParent = path.dirname(snapshotDir);

let exportState = {
  running: false,
  paused: false,
  // "I know there's a half-finished export; let me use the app anyway." The GET
  // handler recomputes `paused` from disk every poll, so clearing the flag above
  // is not enough — the partial files are still there and the next poll would
  // put the modal straight back. This one is only ever set by the user.
  pausedDismissed: false,
  pid: null,
  startedAt: null,
  elapsedSeconds: null,
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

// The cluster the export on disk was started against. Written by the exporters
// right after they clear the directory; absent for snapshots exported before
// that existed, and for a directory nobody has exported into yet.
async function readExportContext() {
  try {
    const raw = await fsp.readFile(path.join(snapshotDir, '.export-context'), 'utf8');
    return JSON.parse(raw).context || null;
  } catch {
    return null;
  }
}

async function currentKubectlContext() {
  try {
    const { stdout } = await execFileAsync('kubectl', ['config', 'current-context'], { timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null; // no kubectl, no kubeconfig, or no context selected
  }
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

// POST /api/snapshot  { command: "start", mode, workers, resume }
router.post('/snapshot', async (req, res) => {
  const command = req.body?.command;

  // --- STOP ---
  if (command === 'stop') {
    if (!exportState.running || !exportState.pid) {
      return res.status(400).json({ error: 'No export running' });
    }
    try {
      process.kill(-exportState.pid, 'SIGTERM');
      exportState.running = false;
      exportState.paused = true;
      return res.json({ stopped: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // --- CLEAR --- (dismiss a finished/failed/paused state so it stops blocking)
  if (command === 'clear') {
    if (exportState.running) {
      return res.status(409).json({ error: 'Export running' });
    }
    exportState.error = null;
    exportState.paused = false;
    exportState.pausedDismissed = true;
    return res.json({ cleared: true });
  }

  // --- DISCARD --- (throw the partial export away and start from nothing)
  if (command === 'discard') {
    if (exportState.running) {
      return res.status(409).json({ error: 'Export running' });
    }
    try {
      await fsp.rm(snapshotDir, { recursive: true, force: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    exportState.paused = false;
    exportState.pausedDismissed = false;
    exportState.error = null;
    exportState.fileCount = 0;
    exportState.totalNamespaces = 0;
    exportState.completedNamespaces = 0;
    return res.json({ discarded: true });
  }

  // --- START ---
  if (exportState.running) {
    return res.status(409).json({ error: 'Export already running' });
  }

  const resume = req.body?.resume === true;

  // Fresh start: clear previous completion markers so the first progress poll
  // doesn't show stale 100% data from the prior export
  if (!resume) {
    await fsp.unlink(path.join(snapshotDir, '.export-complete')).catch(() => {});
    const dirs = await fsp.readdir(snapshotDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      dirs.filter(d => d.isDirectory()).map(d =>
        fsp.unlink(path.join(snapshotDir, d.name, '.done')).catch(() => {})
      )
    );
  }
  // mode: 'bash' | 'node' | 'workers' | 'procs' | 'go' | 'parallel'  (default: 'bash')
  const mode = req.body?.mode ?? 'bash';
  // workers: parallelism count — threads for 'workers', processes for 'procs', jobs for 'parallel'
  const workers = Number.isInteger(req.body?.workers) ? req.body.workers : null;

  exportState = {
    running: true,
    paused: false,
    pausedDismissed: false,
    pid: null,
    startedAt: Date.now(),
    elapsedSeconds: null,
    totalNamespaces: 0,
    completedNamespaces: 0,
    activeNamespaces: new Set(),
    activeResources: new Set(),
    fileCount: 0,
    error: null,
    output: '',
    freshStart: !resume,  // suppress stale filesystem counts on first polls
  };

  let spawnCmd, args;
  if (mode === 'go') {
    const goSrcDir = path.join(PKG_ROOT, 'cmd', 'k8s-export');
    spawnCmd = path.join(goSrcDir, 'k8s-export');
    if (!fs.existsSync(spawnCmd)) {
      exportState.running = false;
      // Two different situations. From a clone the sources are here and the
      // binary is gitignored, so building it is the fix. Installed from npm
      // there is no cmd/ at all — the compiled exporter is ~40MB per platform,
      // so it is not in the package — and telling that user to cd into
      // cmd/k8s-export sends them to a directory that does not exist.
      exportState.error = fs.existsSync(path.join(goSrcDir, 'main.go'))
        ? 'go exporter not built. Run: cd cmd/k8s-export && go build -o k8s-export . — or pick another mode.'
        : 'The go exporter ships with the source, not with the npm package. Pick bash or node, or clone the repo to build it.';
      return res.status(400).json({ error: exportState.error });
    }
    args = [];
    if (workers) args.push('-jobs', String(workers));
  } else if (mode === 'parallel') {
    spawnCmd = 'bash';
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-bash.sh')];
    if (workers) args.push('--jobs', String(workers));
  } else if (mode === 'workers') {
    spawnCmd = process.execPath;
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-node-workers.js')];
    if (workers) args.push('--workers', String(workers));
  } else if (mode === 'procs') {
    spawnCmd = process.execPath;
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-node-procs.js')];
    if (workers) args.push('--procs', String(workers));
  } else if (mode === 'node') {
    spawnCmd = process.execPath;
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-node.js')];
    if (workers) args.push('--jobs', String(workers));
  } else if (mode === 'bash-parallel') {
    spawnCmd = 'bash';
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-bash.sh')];
    if (workers) args.push('--jobs', String(workers));
  } else {
    // bash — sequential (jobs=1) or batch (jobs>1), auto-detects GNU parallel
    spawnCmd = 'bash';
    args = [path.join(PKG_ROOT, 'scripts', 'snapshot-bash.sh')];
    if (workers) args.push('--jobs', String(workers));
  }
  if (resume) args.push('--resume');

  const child = spawn(spawnCmd, args, {
    cwd: snapshotParent,
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
      exportState.freshStart = false;  // script is running — filesystem is being rewritten
    }

    // Parse "=== Namespace: xxx === (complete, skipping)" — already done
    const skipMatches = text.matchAll(/=== Namespace: (.+?) === \(complete, skipping\)/g);
    const skippedSet = new Set();
    for (const m of skipMatches) {
      exportState.completedNamespaces++;
      skippedSet.add(m[1]);
    }

    // Parse "xxx start" (node/workers/procs/go/bash format)
    const nsStartMatches = text.matchAll(/^(\S+) start$/gm);
    for (const m of nsStartMatches) {
      if (!skippedSet.has(m[1])) {
        exportState.activeNamespaces.add(m[1]);
      }
    }

    // Parse "✓ Namespace xxx completed" — remove from active set
    const doneNsMatches = text.matchAll(/✓ Namespace (\S+) completed/g);
    for (const m of doneNsMatches) {
      exportState.activeNamespaces.delete(m[1]);
    }

    // Parse "→ [ns] fetching xxx" or "→ fetching xxx"
    const fetchMatches = text.matchAll(/→ (?:\[\S+\]\s+)?fetching (\S+)/gm);
    for (const m of fetchMatches) {
      for (const r of m[1].split(',')) {
        exportState.activeResources.add(r);
      }
    }

    // Parse "← [ns] xxx done/failed" or "← xxx done/failed"
    const doneResMatches = text.matchAll(/← (?:\[\S+\]\s+)?(\S+) (?:done|failed)/gm);
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
    exportState.elapsedSeconds = exportState.startedAt
      ? Math.round((Date.now() - exportState.startedAt) / 1000)
      : null;
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

// GET /api/snapshot
router.get('/snapshot', async (req, res) => {
  let [liveCount, doneNs, hasCompleteMarker] = await Promise.all([
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

  // "Paused" = a resumable partial export: files on disk, no completion marker,
  // not running, no error. A start→stop that produced zero files is NOT paused —
  // there's nothing to resume — so it falls back to idle (avoids a dead-end modal
  // that only offers "Resume" with 0 files exported).
  const paused = !exportState.running
    && !hasCompleteMarker
    && liveCount > 0
    && !exportState.error
    && !exportState.pausedDismissed;

  // Only the paused panel shows these two, and a running export polls this route
  // once a second — no reason to shell out to kubectl on every one of those.
  let snapshotContext = null;
  let currentContext = null;
  if (paused) {
    [snapshotContext, currentContext] = await Promise.all([
      readExportContext(),
      currentKubectlContext(),
    ]);
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

  // Suppress stale filesystem counts until the new export's first stdout arrives
  if (exportState.freshStart) {
    liveCount = 0;
    doneNs = 0;
    totalNamespaces = 0;
  }

  const activeNsList = [...exportState.activeNamespaces];
  const elapsedSeconds = exportState.running && exportState.startedAt
    ? Math.round((Date.now() - exportState.startedAt) / 1000)
    : exportState.elapsedSeconds;
  const response = {
    running: exportState.running,
    paused,
    totalNamespaces,
    completedNamespaces: doneNs,
    currentNamespace: activeNsList.join(', '),
    activeResources: [...exportState.activeResources],
    fileCount: liveCount,
    etaSeconds,
    elapsedSeconds,
    error: exportState.error,
    snapshotContext,
    currentContext,
  };

  res.json(response);
});


module.exports = router;
