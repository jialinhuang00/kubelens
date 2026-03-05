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

import { loadYaml, loadText } from './snapshot-loader';
import { handleCommand, parseKubectlCommand } from './snapshot-commands';
import type { CommandResult, ParsedCommand } from './snapshot-commands';

export { handleCommand, parseKubectlCommand };
export type { CommandResult, ParsedCommand };

/**
 * Count all resources in a namespace without loading full item lists.
 * Used by `GET /api/resource-counts?namespace=X` for dashboard badges.
 *
 * Pods are counted from `pods-snapshot.txt` line count.
 * YAML resources are counted from `items.length` in each YAML file.
 *
 * @param namespace - K8s namespace
 * @returns Map of resource type → count
 * @example
 * getResourceCounts('demo')
 * // → { pod: 25, deployment: 17, service: 17, configmaps: 10, secrets: 201, ... }
 */
export function getResourceCounts(namespace: string): Record<string, number> {
  const counts: Record<string, number> = {};

  // Pods: count lines in pods-snapshot.txt (minus header)
  const snapshot = loadText('pods-snapshot.txt', namespace);
  if (snapshot) {
    const lines = snapshot.trim().split('\n').slice(1).filter(l => l.trim());
    counts.pod = lines.length;
  } else {
    counts.pod = 0;
  }

  // YAML-backed resources: count items array length
  const yamlResources: Record<string, string> = {
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
