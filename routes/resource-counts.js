const express = require('express');
const { exec } = require('child_process');
const mockK8s = require('../mock-k8s');

const router = express.Router();

// GET /api/resource-counts?namespace=X
// Returns { resourceType: count } for all resource types in a namespace.
// Used by book spine badges to show counts without loading full item lists.
router.get('/resource-counts', (req, res) => {
  const namespace = req.query.namespace;
  if (!namespace) {
    return res.status(400).json({ error: 'namespace query parameter is required' });
  }

  // Mock mode: count from backup YAML files
  if (req.query.mock === 'true') {
    const counts = mockK8s.getResourceCounts(namespace);
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

  const counts = {};
  let completed = 0;

  for (const type of resourceTypes) {
    const cmd = `kubectl get ${type} -n ${namespace} --no-headers 2>/dev/null | wc -l`;
    exec(cmd, { timeout: 10000 }, (error, stdout) => {
      const key = keyMap[type] || type;
      counts[key] = error ? 0 : parseInt(stdout.trim()) || 0;
      completed++;
      if (completed === resourceTypes.length) {
        res.json({ success: true, counts });
      }
    });
  }
});

module.exports = router;
