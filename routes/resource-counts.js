const express = require('express');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const snapshotK8s = require('../snapshot-handler');

const router = express.Router();

// GET /api/resource-counts?namespace=X
// Returns { resourceType: count } for all resource types in a namespace.
// Used by book spine badges to show counts without loading full item lists.
router.get('/resource-counts', async (req, res) => {
  const namespace = req.query.namespace;
  if (!namespace) {
    return res.status(400).json({ error: 'namespace query parameter is required' });
  }

  // Snapshot mode: count from backup YAML files
  if (req.query.snapshot === 'true') {
    const counts = snapshotK8s.getResourceCounts(namespace);
    return res.json({ success: true, counts });
  }

  // Real mode: use kubectl to count resources
  const resourceTypes = [
    'deployments', 'pods', 'services', 'statefulsets', 'cronjobs', 'jobs',
    'configmaps', 'secrets', 'serviceaccounts', 'persistentvolumeclaims',
    'ingresses', 'gateways.gateway.networking.k8s.io', 'httproutes.gateway.networking.k8s.io'
  ];

  const keyMap = {
    'deployments': 'deployment',
    'pods': 'pod',
    'services': 'service',
    'statefulsets': 'statefulsets',
    'cronjobs': 'cronjobs',
    'jobs': 'jobs',
    'configmaps': 'configmaps',
    'secrets': 'secrets',
    'serviceaccounts': 'serviceaccounts',
    'persistentvolumeclaims': 'persistentvolumeclaims',
    'ingresses': 'ingresses',
    'gateways.gateway.networking.k8s.io': 'gateways',
    'httproutes.gateway.networking.k8s.io': 'httproutes',
  };

  try {
    const results = await Promise.all(
      resourceTypes.map(async (type) => {
        const key = keyMap[type] || type;
        try {
          const { stdout } = await execFileAsync(
            'kubectl', ['get', type, '-n', namespace, '--no-headers'],
            { timeout: 10000 }
          );
          return [key, stdout.trim().split('\n').filter(l => l).length];
        } catch {
          return [key, 0];
        }
      })
    );
    const counts = Object.fromEntries(results);
    res.json({ success: true, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
