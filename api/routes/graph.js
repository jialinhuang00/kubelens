const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const { discoverNamespaces, getItemsFromSnapshot, buildGraph } = require('../utils/graph-builder');
const { getGraphResources, isCrd } = require('../utils/config-loader');

const router = express.Router();

// --- Realtime (kubectl) helpers ---

async function execKubectl(args, signal) {
  try {
    const argList = args.split(/\s+/);
    const { stdout } = await execFileAsync('kubectl', argList, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      signal,
    });
    const bytes = Buffer.byteLength(stdout, 'utf8');
    const parsed = JSON.parse(stdout);
    console.log(`[graph] kubectl ${args.split(' -')[0]}: ${(bytes / 1024).toFixed(1)}KB, ${parsed.items?.length ?? 0} items`);
    return { data: parsed, error: null };
  } catch (e) {
    if (e.code === 'ABORT_ERR') return { data: { items: [] }, error: null };
    const stderrLines = [...new Set((e.stderr || '').split('\n').map(l => l.trim()).filter(Boolean))];
    const msg = stderrLines.join('\n') || e.message?.split('\n')[0] || 'Unknown error';
    console.warn(`[graph] kubectl ${args}: ${msg}`);
    return { data: { items: [] }, error: msg };
  }
}

async function fetchLiveData(signal) {
  const graphResources = getGraphResources();
  const builtins = graphResources.filter(r => !isCrd(r));
  const crds = graphResources.filter(r => isCrd(r));

  // One batch for all built-in types; individual calls for CRDs so a missing
  // CRD doesn't fail the core fetch.
  const batches = [
    builtins.map(r => r.resourceType).join(','),
    ...crds.map(r => r.resourceType),
  ];

  // item.kind → internal key (e.g. Deployment → deployments)
  const kindToKey = {};
  for (const r of graphResources) kindToKey[r.kind] = r.key;

  const nsData = new Map();
  const allNamespaces = new Set();

  function ingest(data) {
    for (const item of data?.items || []) {
      const key = kindToKey[item.kind];
      if (!key) continue;
      const ns = item.metadata?.namespace || '_cluster';
      allNamespaces.add(ns);
      if (!nsData.has(ns)) nsData.set(ns, new Map());
      const nsMap = nsData.get(ns);
      if (!nsMap.has(key)) nsMap.set(key, []);
      nsMap.get(key).push(item);
    }
  }

  const results = await Promise.all(
    batches.map(resources => execKubectl(`get ${resources} -A -o json`, signal))
  );

  for (const r of results) ingest(r.data);

  // Core batch (index 0) failing means kubectl itself is broken.
  if (results[0]?.error) throw new Error(results[0].error);

  return { nsData, namespaces: [...allNamespaces] };
}

// GET /api/graph
router.get('/graph', async (req, res) => {
  const isSnapshot = req.query.snapshot === 'true';

  try {
    if (isSnapshot) {
      const rootDir = path.join(__dirname, '../..');
      const localBackup = path.join(rootDir, 'k8s-snapshot');
      const fallbackPath = process.env.K8S_SNAPSHOT_PATH || localBackup;

      const dataPath = fs.existsSync(localBackup) ? localBackup : fallbackPath;

      const namespaceDirs = discoverNamespaces(dataPath);
      const namespaceList = [...namespaceDirs.keys()];

      const getItemsFn = (ns, resourceKey) => {
        const nsDir = namespaceDirs.get(ns);
        if (!nsDir) return [];
        return getItemsFromSnapshot(nsDir, resourceKey);
      };

      res.json(buildGraph(getItemsFn, namespaceList));
    } else {
      // Abort kubectl processes if client disconnects (e.g. mode switch)
      const ac = new AbortController();
      req.on('close', () => {
        if (!res.writableFinished) {
          console.log('\x1b[31m[graph] Client disconnected — aborting kubectl processes\x1b[0m');
          ac.abort();
        }
      });

      const { nsData, namespaces } = await fetchLiveData(ac.signal);

      const getItemsFn = (ns, resourceKey) => {
        const nsMap = nsData.get(ns);
        if (!nsMap) return [];
        return nsMap.get(resourceKey) || [];
      };

      res.json(buildGraph(getItemsFn, namespaces));
    }
  } catch (err) {
    console.error('[graph] Error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to fetch graph data' });
  }
});

module.exports = router;
