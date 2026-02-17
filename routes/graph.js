const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const { discoverNamespaces, getItemsFromSnapshot, buildGraph } = require('../utils/graph-builder');

const router = express.Router();

// --- Realtime (kubectl) helpers ---

async function execKubectl(args) {
  try {
    const argList = args.split(/\s+/);
    const { stdout } = await execFileAsync('kubectl', argList, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });
    const bytes = Buffer.byteLength(stdout, 'utf8');
    const parsed = JSON.parse(stdout);
    console.log(`[graph] kubectl ${args.split(' -')[0]}: ${(bytes / 1024).toFixed(1)}KB, ${parsed.items?.length ?? 0} items`);
    return parsed;
  } catch (e) {
    console.warn(`[graph] kubectl ${args}: ${e.message?.split('\n')[0]}`);
    return { items: [] };
  }
}

async function fetchLiveData() {
  const batches = [
    { resources: 'deployments,statefulsets,daemonsets,cronjobs', keys: ['deployments', 'statefulsets', 'daemonsets', 'cronjobs'] },
    { resources: 'services,configmaps,ingresses', keys: ['services', 'configmaps', 'ingresses'] },
    { resources: 'secrets,serviceaccounts,rolebindings', keys: ['secrets', 'serviceaccounts', 'rolebindings'] },
    { resources: 'pods', keys: ['pods'] },
    { resources: 'hpa', keys: ['horizontalpodautoscalers'] },
    { resources: 'pvc', keys: ['persistentvolumeclaims'] },
  ];

  const optionalBatches = [
    { resources: 'gateways.gateway.networking.k8s.io', keys: ['gateways'] },
    { resources: 'httproutes.gateway.networking.k8s.io', keys: ['httproutes'] },
    { resources: 'tcproutes.gateway.networking.k8s.io', keys: ['tcproutes'] },
  ];

  const nsData = new Map();
  const allNamespaces = new Set();

  function ingest(data, keys) {
    const items = data?.items || [];
    const kindToKey = {};
    for (const key of keys) {
      const kindMap = {
        'deployments': 'Deployment',
        'statefulsets': 'StatefulSet',
        'daemonsets': 'DaemonSet',
        'cronjobs': 'CronJob',
        'services': 'Service',
        'configmaps': 'ConfigMap',
        'ingresses': 'Ingress',
        'secrets': 'Secret',
        'serviceaccounts': 'ServiceAccount',
        'rolebindings': 'RoleBinding',
        'pods': 'Pod',
        'horizontalpodautoscalers': 'HorizontalPodAutoscaler',
        'persistentvolumeclaims': 'PersistentVolumeClaim',
        'gateways': 'Gateway',
        'httproutes': 'HTTPRoute',
        'tcproutes': 'TCPRoute',
      };
      if (kindMap[key]) kindToKey[kindMap[key]] = key;
    }

    for (const item of items) {
      const ns = item.metadata?.namespace || '_cluster';
      const kind = item.kind;
      const key = kindToKey[kind] || keys[0];

      allNamespaces.add(ns);
      if (!nsData.has(ns)) nsData.set(ns, new Map());
      const nsMap = nsData.get(ns);
      if (!nsMap.has(key)) nsMap.set(key, []);
      nsMap.get(key).push(item);
    }
  }

  const allBatches = [...batches, ...optionalBatches];
  const results = await Promise.all(
    allBatches.map(batch => execKubectl(`get ${batch.resources} -A -o json`))
  );

  for (let i = 0; i < allBatches.length; i++) {
    ingest(results[i], allBatches[i].keys);
  }

  return { nsData, namespaces: [...allNamespaces] };
}

// GET /api/graph
router.get('/graph', async (req, res) => {
  const isSnapshot = req.query.snapshot === 'true';

  try {
    if (isSnapshot) {
      const rootDir = path.join(__dirname, '..');
      const localBackup = path.join(rootDir, 'k8s-snapshot');
      const fallbackPath = process.env.K8S_SNAPSHOT_PATH || localBackup;

      let dataPaths;
      if (req.query.path) {
        dataPaths = [path.resolve(req.query.path)];
      } else if (fs.existsSync(localBackup)) {
        dataPaths = [localBackup];
      } else {
        dataPaths = [fallbackPath];
      }

      const namespaceDirs = discoverNamespaces(dataPaths);
      const namespaceList = [...namespaceDirs.keys()];

      const getItemsFn = (ns, resourceKey) => {
        const nsDir = namespaceDirs.get(ns);
        if (!nsDir) return [];
        return getItemsFromSnapshot(nsDir, resourceKey);
      };

      res.json(buildGraph(getItemsFn, namespaceList));
    } else {
      const { nsData, namespaces } = await fetchLiveData();

      const getItemsFn = (ns, resourceKey) => {
        const nsMap = nsData.get(ns);
        if (!nsMap) return [];
        return nsMap.get(resourceKey) || [];
      };

      res.json(buildGraph(getItemsFn, namespaces));
    }
  } catch (err) {
    console.error('[graph] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch graph data' });
  }
});

module.exports = router;
