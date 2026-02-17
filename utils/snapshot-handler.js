/**
 * K8s snapshot handler — re-export shim.
 * Delegates command handling to snapshot-commands and keeps getResourceCounts here
 * since it only needs the loader directly.
 *
 * Public API (unchanged):
 *   handleCommand(command) → { success, stdout?, error? }
 *   parseKubectlCommand(command) → parsed object
 *   getResourceCounts(namespace) → { resourceType: count }
 */

const { loadYaml, loadText } = require('./snapshot-loader');
const { handleCommand, parseKubectlCommand } = require('./snapshot-commands');

// --- Resource counts ---
// Returns { resourceType: count } for all YAML-backed resources + pods in a namespace.
// Used by GET /api/resource-counts?namespace=X to populate book spine badges without
// loading full item lists.

function getResourceCounts(namespace) {
  const counts = {};

  // Pods: count lines in pods-snapshot.txt (minus header)
  const snapshot = loadText('pods-snapshot.txt', namespace);
  if (snapshot) {
    const lines = snapshot.trim().split('\n').slice(1).filter(l => l.trim());
    counts.pod = lines.length;
  } else {
    counts.pod = 0;
  }

  // YAML-backed resources: count items array length
  const yamlResources = {
    deployment: 'deployments.yaml',
    service: 'services.yaml',
    statefulsets: 'statefulsets.yaml',
    cronjobs: 'cronjobs.yaml',
    jobs: 'jobs.yaml',
    configmaps: 'configmaps.yaml',
    secrets: 'secrets.yaml',
    serviceaccounts: 'serviceaccounts.yaml',
    persistentvolumeclaims: 'persistentvolumeclaims.yaml',
    ingresses: 'ingresses.yaml',
    gateways: 'gateways.yaml',
    httproutes: 'httproutes.yaml',
  };

  for (const [key, file] of Object.entries(yamlResources)) {
    const data = loadYaml(file, namespace);
    counts[key] = data?.items?.length || 0;
  }

  return counts;
}

module.exports = { handleCommand, parseKubectlCommand, getResourceCounts };
