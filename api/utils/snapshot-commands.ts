/**
 * Snapshot commands — kubectl command parser and all action handlers.
 * Processes parsed commands against cached snapshot data.
 */

import yaml from 'js-yaml';
import { loadYaml, loadText, listBackupNamespaces, DEFAULT_NAMESPACE } from './snapshot-loader';
import type { K8sItem, K8sList } from './snapshot-loader';
import {
  extractNames, findItem, pad, getAge,
  generateDeploymentTable, generateServiceTable, generateCronjobTable,
  generateStatefulsetTable, generateJobTable, generateConfigmapTable,
  generateEndpointTable,
  generateDeploymentDescribe, generatePodDescribe, generateServiceDescribe,
  generateGenericDescribe,
} from './snapshot-parsers';

/** Result from handleCommand(). Either `{ success: true, stdout }` or `{ success: false, error }`. */
export interface CommandResult {
  success: boolean;
  stdout?: string;
  error?: string;
}

/**
 * Parsed representation of a kubectl command string.
 * @example
 * // 'kubectl get deployment web -n demo -o json' parses to:
 * {
 *   action: 'get',
 *   subAction: null,
 *   resource: 'deployment',
 *   resourceName: 'web',
 *   namespace: 'demo',
 *   output: 'json',
 *   flags: {},
 *   raw: 'kubectl get deployment web -n demo -o json'
 * }
 */
export interface ParsedCommand {
  action: string | null;
  subAction: string | null;
  resource: string | null;
  resourceName: string | null;
  namespace: string | undefined;
  output: string | null;
  flags: Record<string, unknown>;
  raw: string;
}

// --- Resource mapping ---
const RESOURCE_FILE_MAP: Record<string, string | null> = {
  'deployments': 'deployments.yaml',
  'deployment': 'deployments.yaml',
  'deploy': 'deployments.yaml',
  'services': 'services.yaml',
  'service': 'services.yaml',
  'svc': 'services.yaml',
  'pods': null,
  'pod': null,
  'cronjobs': 'cronjobs.yaml',
  'cronjob': 'cronjobs.yaml',
  'jobs': 'jobs.yaml',
  'job': 'jobs.yaml',
  'statefulsets': 'statefulsets.yaml',
  'statefulset': 'statefulsets.yaml',
  'sts': 'statefulsets.yaml',
  'configmaps': 'configmaps.yaml',
  'configmap': 'configmaps.yaml',
  'cm': 'configmaps.yaml',
  'endpoints': 'endpoints.yaml',
  'ep': 'endpoints.yaml',
  'secrets': 'secrets.yaml',
  'secret': 'secrets.yaml',
  'serviceaccounts': 'serviceaccounts.yaml',
  'serviceaccount': 'serviceaccounts.yaml',
  'sa': 'serviceaccounts.yaml',
  'namespaces': null,
  'namespace': null,
  'ns': null,
  'nodes': null,
  'node': null,
  'replicasets': null,
  'replicaset': null,
  'rs': null,
  'persistentvolumeclaims': 'persistentvolumeclaims.yaml',
  'persistentvolumeclaim': 'persistentvolumeclaims.yaml',
  'pvc': 'persistentvolumeclaims.yaml',
  'poddisruptionbudgets': 'poddisruptionbudgets.yaml',
  'poddisruptionbudget': 'poddisruptionbudgets.yaml',
  'pdb': 'poddisruptionbudgets.yaml',
  'gateways': 'gateways.yaml',
  'gateway': 'gateways.yaml',
  'httproutes': 'httproutes.yaml',
  'httproute': 'httproutes.yaml',
  'tcproutes': 'tcproutes.yaml',
  'tcproute': 'tcproutes.yaml',
  'events': null,
  'event': null,
  'roles': 'roles.yaml',
  'role': 'roles.yaml',
  'rolebindings': 'rolebindings.yaml',
  'rolebinding': 'rolebindings.yaml',
};

const TABLE_GENERATORS: Record<string, (items: K8sItem[]) => string> = {
  'deployments.yaml': generateDeploymentTable,
  'services.yaml': generateServiceTable,
  'cronjobs.yaml': generateCronjobTable,
  'statefulsets.yaml': generateStatefulsetTable,
  'jobs.yaml': generateJobTable,
  'configmaps.yaml': generateConfigmapTable,
  'endpoints.yaml': generateEndpointTable,
};

// --- Command parser ---

/**
 * Parse a kubectl command string into structured parts. Pure function, no I/O.
 * @param command - Full command string starting with `'kubectl'`
 * @returns Parsed command object, or `null` if not a kubectl command
 * @example
 * parseKubectlCommand('kubectl get pods -n kube-system')
 * // → { action: 'get', resource: 'pods', namespace: 'kube-system', ... }
 *
 * parseKubectlCommand('kubectl rollout status deployment/web')
 * // → { action: 'rollout', subAction: 'status', resource: 'deployment/web', ... }
 *
 * parseKubectlCommand('docker ps')
 * // → null
 */
export function parseKubectlCommand(command: string): ParsedCommand | null {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== 'kubectl') return null;

  const result: ParsedCommand = {
    action: null,
    subAction: null,
    resource: null,
    resourceName: null,
    namespace: undefined,
    output: null,
    flags: {},
    raw: command,
  };

  let i = 1;
  while (i < parts.length) {
    const part = parts[i];

    if (!result.action) {
      result.action = part;
      i++;
      continue;
    }

    if ((result.action === 'rollout' || result.action === 'config' || result.action === 'set') && !result.subAction) {
      result.subAction = part;
      i++;
      continue;
    }

    if (part === '-n' || part === '--namespace') {
      result.namespace = parts[i + 1]?.replace(/^['"]|['"]$/g, '');
      i += 2;
      continue;
    }

    if (part === '-o' || part === '--output') {
      result.output = parts[i + 1];
      if (result.output && result.output.startsWith('"')) {
        let combined = result.output;
        while (!combined.endsWith('"') && i + 2 < parts.length) {
          i++;
          combined += ' ' + parts[i + 1];
        }
        result.output = combined.replace(/^"|"$/g, '');
      }
      i += 2;
      continue;
    }

    if (part.startsWith('-o') && part.length > 2) {
      result.output = part.substring(2);
      i++;
      continue;
    }

    if (part.startsWith('--') || part.startsWith('-')) {
      if (part === '--all-namespaces' || part === '-A') {
        result.flags.allNamespaces = true;
        i++;
        continue;
      }
      if (part === '--no-headers') {
        result.flags.noHeaders = true;
        i++;
        continue;
      }
      if (part.includes('=')) {
        const [key, val] = part.split('=');
        result.flags[key.replace(/^-+/, '')] = val;
      } else if (part === '--tail' || part === '--timeout' || part === '--revision' ||
                 part === '--field-selector' || part === '--sort-by' || part === '-l' ||
                 part === '-c' || part === '--image') {
        result.flags[part.replace(/^-+/, '')] = parts[i + 1];
        i += 2;
        continue;
      } else {
        result.flags[part.replace(/^-+/, '')] = true;
      }
      i++;
      continue;
    }

    if (!result.resource) {
      result.resource = part;
    } else if (!result.resourceName) {
      result.resourceName = part;
    }
    i++;
  }

  if (result.resource === 'all') {
    result.flags.getAll = true;
  }

  return result;
}

// --- Main handler ---

/**
 * Execute a kubectl command against snapshot data. This is the main entry point
 * for snapshot mode — it parses the command, dispatches to the appropriate handler
 * (get/describe/rollout/config/logs/set), and returns the result.
 *
 * **No real kubectl is executed.** Read-only commands (get, describe) return data
 * from `k8s-snapshot/` YAML files. Mutating commands (apply, patch) return
 * hardcoded success strings. Unsupported commands (exec, delete) return errors.
 *
 * @param command - Full kubectl command string
 * @returns `{ success: true, stdout: '...' }` or `{ success: false, error: '...' }`
 * @example
 * handleCommand('kubectl get deployments -n demo')
 * // → { success: true, stdout: 'NAME ... READY ...\napi-server ... 2/2 ...' }
 *
 * handleCommand('kubectl delete pod foo')
 * // → { success: false, error: '[SNAPSHOT] delete is not supported in snapshot mode (read-only)' }
 */
export function handleCommand(command: string): CommandResult {
  const parsed = parseKubectlCommand(command);
  if (!parsed) {
    return { success: false, error: 'Failed to parse command' };
  }

  try {
    switch (parsed.action) {
      case 'get':
        return handleGet(parsed);
      case 'describe':
        return handleDescribe(parsed);
      case 'rollout':
        return handleRollout(parsed);
      case 'config':
        return handleConfig(parsed);
      case 'logs':
        return handleLogs(parsed);
      case 'exec':
        return { success: false, error: '[SNAPSHOT] exec is not supported in snapshot mode' };
      case 'delete':
        return { success: false, error: '[SNAPSHOT] delete is not supported in snapshot mode (read-only)' };
      case 'set':
        return handleSet(parsed);
      case 'port-forward':
        return { success: false, error: '[SNAPSHOT] port-forward is not supported in snapshot mode' };
      case 'patch':
        return { success: true, stdout: `service/${parsed.resourceName || 'unknown'} patched (snapshot)` };
      case 'run':
        return { success: true, stdout: 'pod/test-connectivity created (snapshot)\nConnection successful' };
      case 'apply':
        return { success: true, stdout: 'resource applied (snapshot)' };
      default:
        return { success: false, error: `[SNAPSHOT] Unsupported action: ${parsed.action}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SNAPSHOT] Error:', err);
    return { success: false, error: `[SNAPSHOT] Error: ${msg}` };
  }
}

// --- GET handler ---

function handleGet(parsed: ParsedCommand): CommandResult {
  if (parsed.flags.getAll) {
    return handleGetAll(parsed);
  }

  if (['namespaces', 'namespace', 'ns'].includes(parsed.resource!)) {
    return handleGetNamespaces(parsed);
  }

  if (['nodes', 'node'].includes(parsed.resource!)) {
    return handleGetNodes(parsed);
  }

  if (['events', 'event', 'ev'].includes(parsed.resource!)) {
    return handleGetEvents(parsed);
  }

  if (['pods', 'pod'].includes(parsed.resource!)) {
    return handleGetPods(parsed);
  }

  if (['replicasets', 'replicaset', 'rs'].includes(parsed.resource!)) {
    return handleGetReplicasets(parsed);
  }

  const yamlFile = RESOURCE_FILE_MAP[parsed.resource!];
  if (!yamlFile) {
    return { success: false, error: `[SNAPSHOT] Unknown resource type: ${parsed.resource}` };
  }

  const ns = parsed.namespace;
  const data = loadYaml(yamlFile, ns);
  if (!data) {
    return { success: false, error: `[SNAPSHOT] No backup data for ${parsed.resource}` };
  }

  if (parsed.resourceName) {
    const item = findItem(data, parsed.resourceName);
    if (!item) {
      return { success: false, error: `Error from server (NotFound): ${parsed.resource} "${parsed.resourceName}" not found` };
    }

    if (parsed.output === 'json') {
      return { success: true, stdout: JSON.stringify(item, null, 2) };
    }
    if (parsed.output === 'yaml') {
      return { success: true, stdout: yaml.dump(item) };
    }
    if (parsed.output && parsed.output.startsWith('jsonpath=')) {
      const jp = parsed.output.replace('jsonpath=', '').replace(/^"|"$/g, '');
      if (jp === '{.data}' && item.data) {
        const decoded: Record<string, string> = {};
        for (const [k, v] of Object.entries(item.data)) {
          try { decoded[k] = Buffer.from(v, 'base64').toString('utf-8'); }
          catch { decoded[k] = v; }
        }
        return { success: true, stdout: JSON.stringify(decoded, null, 2) };
      }
      const jsonPath = jp.replace(/^\{\.?/, '').replace(/\}$/, '');
      const val = resolveJsonPath(item, jsonPath);
      return { success: true, stdout: typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val || '') };
    }
    const generator = TABLE_GENERATORS[yamlFile];
    if (generator) {
      return { success: true, stdout: generator([item]) };
    }
    return { success: true, stdout: yaml.dump(item) };
  }

  const items = data.items || [];

  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const jsonpath = parsed.output.replace('jsonpath=', '').replace(/^"|"$/g, '');
    if (jsonpath.includes('.metadata.name')) {
      return { success: true, stdout: extractNames(data).join(' ') };
    }
    return { success: true, stdout: extractNames(data).join(' ') };
  }

  if (parsed.output === 'json') {
    return { success: true, stdout: JSON.stringify(data, null, 2) };
  }

  if (parsed.output === 'yaml') {
    return { success: true, stdout: yaml.dump(data) };
  }

  if (parsed.output && parsed.output.startsWith('custom-columns=')) {
    return handleCustomColumns(parsed, items);
  }

  const generator = TABLE_GENERATORS[yamlFile];
  if (generator) {
    let output = generator(items);
    if (parsed.flags.noHeaders) {
      output = output.split('\n').slice(1).join('\n');
    }
    return { success: true, stdout: output };
  }

  return { success: true, stdout: extractNames(data).join('\n') };
}

function handleGetNamespaces(parsed: ParsedCommand): CommandResult {
  const namespaces = listBackupNamespaces();

  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    return { success: true, stdout: namespaces.join(' ') };
  }
  if (parsed.output === 'json') {
    return {
      success: true,
      stdout: JSON.stringify({
        apiVersion: 'v1',
        kind: 'NamespaceList',
        items: namespaces.map(ns => ({ metadata: { name: ns }, status: { phase: 'Active' } }))
      }, null, 2)
    };
  }
  const header = 'NAME                    STATUS   AGE';
  const rows = namespaces.map(ns => `${pad(ns, 24)}Active   200d`);
  let output = [header, ...rows].join('\n');
  if (parsed.flags.noHeaders) output = rows.join('\n');
  return { success: true, stdout: output };
}

function handleGetNodes(parsed: ParsedCommand): CommandResult {
  const node = {
    name: 'ip-10-0-1-50.ec2.internal',
    status: 'Ready',
    roles: '<none>',
    age: '365d',
    version: 'v1.29.3-eks-ae9a62a',
    internalIP: '10.0.1.50',
    os: 'linux/arm64',
    kernel: '5.10.219-208.866.amzn2.aarch64',
    runtime: 'containerd://1.7.11',
  };
  const node2 = {
    name: 'ip-10-0-2-80.ec2.internal',
    status: 'Ready',
    roles: '<none>',
    age: '200d',
    version: 'v1.29.3-eks-ae9a62a',
    internalIP: '10.0.2.80',
    os: 'linux/arm64',
    kernel: '5.10.219-208.866.amzn2.aarch64',
    runtime: 'containerd://1.7.11',
  };
  const nodes = [node, node2];

  if (parsed.output === 'wide') {
    const header = 'NAME                                STATUS   ROLES    AGE    VERSION                  INTERNAL-IP      EXTERNAL-IP   OS-IMAGE         KERNEL-VERSION                       CONTAINER-RUNTIME';
    const rows = nodes.map(n =>
      `${pad(n.name, 36)}${pad(n.status, 9)}${pad(n.roles, 9)}${pad(n.age, 7)}${pad(n.version, 25)}${pad(n.internalIP, 17)}${'<none>           '}${'Amazon Linux 2   '}${pad(n.kernel, 37)}${n.runtime}`
    );
    return { success: true, stdout: [header, ...rows].join('\n') };
  }

  const header = 'NAME                                STATUS   ROLES    AGE    VERSION';
  const rows = nodes.map(n =>
    `${pad(n.name, 36)}${pad(n.status, 9)}${pad(n.roles, 9)}${pad(n.age, 7)}${n.version}`
  );
  let output = [header, ...rows].join('\n');
  if (parsed.flags.noHeaders) output = rows.join('\n');
  return { success: true, stdout: output };
}

interface PodJson {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string };
  spec?: { containers: Array<{ name: string; image: string }> };
  status: {
    phase: string;
    podIP: string;
    hostIP: string;
    containerStatuses: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state?: { running: { startedAt: string } };
      image?: string;
      imageID?: string;
    }>;
  };
}

function handleGetPods(parsed: ParsedCommand): CommandResult {
  const ns = parsed.namespace;
  const snapshot = loadText('pods-snapshot.txt', ns);
  const images = loadText('pods-images.txt', ns);

  if (!snapshot) {
    if (parsed.output && parsed.output.startsWith('jsonpath=')) return { success: true, stdout: '' };
    return { success: true, stdout: 'No resources found in namespace.' };
  }

  const lines = snapshot.trim().split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);

  if (parsed.resourceName) {
    const podLine = dataLines.find(l => l.trim().startsWith(parsed.resourceName!));
    if (!podLine) return { success: false, error: `Error from server (NotFound): pods "${parsed.resourceName}" not found` };

    if (parsed.output === 'json') {
      return { success: true, stdout: JSON.stringify(buildPodJson(podLine, ns, images), null, 2) };
    }
    if (parsed.output === 'yaml') {
      return { success: true, stdout: yaml.dump(buildPodJson(podLine, ns, images)) };
    }
    if (parsed.flags.noHeaders) return { success: true, stdout: podLine };
    return { success: true, stdout: [header, podLine].join('\n') };
  }

  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const names = dataLines.map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    return { success: true, stdout: names.join(' ') };
  }

  if (parsed.output && (parsed.output.startsWith('custom-columns=') || parsed.output.startsWith('"custom-columns='))) {
    const cleanOutput = parsed.output.replace(/^"|"$/g, '');
    if ((cleanOutput.includes('IMAGE') || cleanOutput.includes('image')) && images) {
      let output = images;
      if (parsed.flags.noHeaders) output = images.split('\n').slice(1).join('\n');
      return { success: true, stdout: output.trim() };
    }
    return { success: true, stdout: snapshot.trim() };
  }

  let output = snapshot.trim();
  if (parsed.flags.noHeaders) output = dataLines.join('\n');
  return { success: true, stdout: output };
}

function buildPodJson(podLine: string, ns: string | undefined, imagesText: string | null): PodJson {
  const parts = podLine.trim().split(/\s+/);
  const podJson: PodJson = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: parts[0], namespace: ns || DEFAULT_NAMESPACE },
    status: {
      phase: parts[2],
      podIP: parts[5] || '',
      hostIP: parts[6] || '',
      containerStatuses: [{
        name: 'main',
        ready: parts[1] === '1/1',
        restartCount: parseInt(parts[3]) || 0,
        state: { running: { startedAt: new Date().toISOString() } }
      }]
    }
  };
  if (imagesText) {
    const imgLine = imagesText.trim().split('\n').find(l => l.trim().startsWith(parts[0]));
    if (imgLine) {
      const imageStr = imgLine.trim().split(/\s+/).slice(1).join(' ');
      podJson.spec = {
        containers: imageStr.split(',').map((img, idx) => ({
          name: idx === 0 ? 'main' : `sidecar-${idx}`,
          image: img.trim()
        }))
      };
      podJson.status.containerStatuses = imageStr.split(',').map((img, idx) => ({
        name: idx === 0 ? 'main' : `sidecar-${idx}`,
        image: img.trim(),
        imageID: img.trim(),
        ready: parts[1] === '1/1',
        restartCount: parseInt(parts[3]) || 0,
      }));
    }
  }
  return podJson;
}

function handleGetReplicasets(parsed: ParsedCommand): CommandResult {
  const data = loadYaml('deployments.yaml', parsed.namespace);
  if (!data) return { success: true, stdout: 'No resources found.' };

  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const names = (data.items || []).map(d => `${d.metadata.name}-${d.metadata.generation || '1'}`);
    return { success: true, stdout: names.join(' ') };
  }

  if (parsed.output && parsed.output.startsWith('custom-columns=')) {
    const header = 'REPLICASET                                    DEPLOYMENT                          DESIRED   CURRENT   READY';
    const rows = (data.items || []).map(d => {
      const spec = (d.spec || {}) as Record<string, unknown>;
      const template = (spec.template || {}) as Record<string, unknown>;
      const templateMeta = (template.metadata || {}) as Record<string, unknown>;
      const templateLabels = (templateMeta.labels || {}) as Record<string, string>;
      const status = (d.status || {}) as Record<string, unknown>;
      const rsName = `${d.metadata.name}-${(templateLabels['pod-template-hash'] || 'abc123').substring(0, 10)}`;
      return `${pad(rsName, 46)}${pad(d.metadata.name, 36)}${pad(String((spec.replicas as number) || 1), 10)}${pad(String((status.replicas as number) || 0), 10)}${(status.readyReplicas as number) || 0}`;
    });
    let output = [header, ...rows].join('\n');
    if (parsed.flags.noHeaders) output = rows.join('\n');
    return { success: true, stdout: output };
  }

  const header = 'NAME                                          DESIRED   CURRENT   READY   AGE';
  const rows = (data.items || []).map(d => {
    const spec = (d.spec || {}) as Record<string, unknown>;
    const status = (d.status || {}) as Record<string, unknown>;
    const rsName = `${d.metadata.name}-${String(d.metadata.generation || '1').padStart(2, '0')}`;
    return `${pad(rsName, 46)}${pad(String((spec.replicas as number) || 1), 10)}${pad(String((status.replicas as number) || 0), 10)}${pad(String((status.readyReplicas as number) || 0), 8)}${getAge(d.metadata.creationTimestamp)}`;
  });
  let output = [header, ...rows].join('\n');
  if (parsed.flags.noHeaders) output = rows.join('\n');
  return { success: true, stdout: output };
}

function handleGetEvents(parsed: ParsedCommand): CommandResult {
  const events = [
    `LAST SEEN   TYPE      REASON              OBJECT                                        MESSAGE`,
    `3m          Normal    Scheduled           pod/web-app-7449d97884-j7bt5                  Successfully assigned ${DEFAULT_NAMESPACE}/web-app-7449d97884-j7bt5 to ip-10-0-1-50.ec2.internal`,
    `3m          Normal    Pulled              pod/web-app-7449d97884-j7bt5                  Container image already present on machine`,
    `3m          Normal    Created             pod/web-app-7449d97884-j7bt5                  Created container web-app`,
    `3m          Normal    Started             pod/web-app-7449d97884-j7bt5                  Started container web-app`,
    `10h         Normal    ScalingReplicaSet   deployment/web-app                            Scaled up replica set web-app-7449d97884 to 1`,
    `23h         Normal    ScalingReplicaSet   deployment/api-server                         Scaled up replica set api-server-86997f5d7f to 1`,
    `23h         Warning   BackOff             pod/worker-86565f7d48-2v46j                   Back-off restarting failed container`,
  ];

  if (parsed.output === 'json') {
    return {
      success: true,
      stdout: JSON.stringify({
        apiVersion: 'v1',
        kind: 'EventList',
        items: []
      }, null, 2)
    };
  }

  return { success: true, stdout: events.join('\n') };
}

function handleGetAll(parsed: ParsedCommand): CommandResult {
  const ns = parsed.namespace || DEFAULT_NAMESPACE;
  const parts: string[] = [];

  const snapshot = loadText('pods-snapshot.txt', ns);
  if (snapshot) {
    const lines = snapshot.trim().split('\n');
    const header = lines[0];
    const podLines = lines.slice(1).map(l => `pod/${l.trim().split(/\s+/)[0]}   ${l.trim().split(/\s+/).slice(1).join('   ')}`);
    parts.push(`=== POD ===\n${header}\n${podLines.join('\n')}`);
  }

  const deployData = loadYaml('deployments.yaml', ns);
  if (deployData) {
    parts.push(`=== DEPLOYMENT ===\n${generateDeploymentTable(deployData.items || [])}`);
  }

  const svcData = loadYaml('services.yaml', ns);
  if (svcData) {
    parts.push(`=== SERVICE ===\n${generateServiceTable(svcData.items || [])}`);
  }

  const stsData = loadYaml('statefulsets.yaml', ns);
  if (stsData) {
    parts.push(`=== STATEFULSET ===\n${generateStatefulsetTable(stsData.items || [])}`);
  }

  const cjData = loadYaml('cronjobs.yaml', ns);
  if (cjData) {
    parts.push(`=== CRONJOB ===\n${generateCronjobTable(cjData.items || [])}`);
  }

  const jobData = loadYaml('jobs.yaml', ns);
  if (jobData) {
    parts.push(`=== JOB ===\n${generateJobTable(jobData.items || [])}`);
  }

  return { success: true, stdout: parts.join('\n\n') };
}

function handleCustomColumns(parsed: ParsedCommand, items: K8sItem[]): CommandResult {
  const spec = parsed.output!.replace('custom-columns=', '').replace(/^"|"$/g, '');
  const columns = spec.split(',').map(col => {
    const [label, jsonPath] = col.split(':');
    return { label: label.trim(), path: jsonPath?.trim() };
  });

  const header = columns.map(c => pad(c.label, 40)).join('');
  const rows = items.map(item => {
    return columns.map(c => {
      const val = resolveJsonPath(item, c.path);
      return pad(String(val), 40);
    }).join('');
  });

  let output = [header, ...rows].join('\n');
  if (parsed.flags?.noHeaders) output = rows.join('\n');
  return { success: true, stdout: output };
}

function resolveJsonPath(obj: unknown, pathStr: string | undefined): unknown {
  if (!pathStr) return '';
  const cleanPath = pathStr.replace(/^\.(.*)/,'$1');
  const parts = cleanPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current) return '<none>';
    const arrayMatch = part.match(/^(.+)\[\*\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      current = (current as Record<string, unknown>)[key];
      if (Array.isArray(current)) {
        const nextParts = parts.slice(parts.indexOf(part) + 1);
        if (nextParts.length > 0) {
          return current.map(item => {
            let val: unknown = item;
            for (const np of nextParts) val = (val as Record<string, unknown>)?.[np];
            return val || '<none>';
          }).join(',');
        }
        return current.join(',');
      }
      return current || '<none>';
    }
    const indexMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (indexMatch) {
      current = ((current as Record<string, unknown>)[indexMatch[1]] as unknown[])?.[parseInt(indexMatch[2])];
      continue;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined && current !== null ? current : '<none>';
}

// --- DESCRIBE handler ---

function handleDescribe(parsed: ParsedCommand): CommandResult {
  const resource = parsed.resource;
  const name = parsed.resourceName;

  if (['deployment', 'deployments', 'deploy'].includes(resource!)) {
    const data = loadYaml('deployments.yaml', parsed.namespace);
    if (!data) return { success: false, error: 'No deployment data' };
    if (name) {
      const item = findItem(data, name);
      return { success: true, stdout: generateDeploymentDescribe(item) };
    }
    return {
      success: true,
      stdout: (data.items || []).map(item => generateDeploymentDescribe(item)).join('\n\n---\n\n')
    };
  }

  if (['pod', 'pods'].includes(resource!)) {
    const ns = parsed.namespace;
    if (name) {
      return { success: true, stdout: generatePodDescribe(name, ns) };
    }
    const snapshot = loadText('pods-snapshot.txt', ns);
    if (!snapshot) return { success: false, error: 'No pod data' };
    const names = snapshot.trim().split('\n').slice(1).map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    return {
      success: true,
      stdout: names.map(n => generatePodDescribe(n, ns)).join('\n\n---\n\n')
    };
  }

  if (['service', 'services', 'svc'].includes(resource!)) {
    const data = loadYaml('services.yaml', parsed.namespace);
    if (!data) return { success: false, error: 'No service data' };
    if (name) {
      const item = findItem(data, name);
      return { success: true, stdout: generateServiceDescribe(item) };
    }
    return {
      success: true,
      stdout: (data.items || []).map(item => generateServiceDescribe(item)).join('\n\n---\n\n')
    };
  }

  const fileMap: Record<string, string> = {
    'secret': 'secrets.yaml', 'secrets': 'secrets.yaml',
    'configmap': 'configmaps.yaml', 'configmaps': 'configmaps.yaml', 'cm': 'configmaps.yaml',
    'serviceaccount': 'serviceaccounts.yaml', 'serviceaccounts': 'serviceaccounts.yaml', 'sa': 'serviceaccounts.yaml',
    'statefulset': 'statefulsets.yaml', 'statefulsets': 'statefulsets.yaml', 'sts': 'statefulsets.yaml',
    'cronjob': 'cronjobs.yaml', 'cronjobs': 'cronjobs.yaml',
    'job': 'jobs.yaml', 'jobs': 'jobs.yaml',
    'persistentvolumeclaim': 'persistentvolumeclaims.yaml', 'persistentvolumeclaims': 'persistentvolumeclaims.yaml', 'pvc': 'persistentvolumeclaims.yaml',
    'ingress': 'ingresses.yaml', 'ingresses': 'ingresses.yaml',
    'gateway': 'gateways.yaml', 'gateways': 'gateways.yaml',
    'httproute': 'httproutes.yaml', 'httproutes': 'httproutes.yaml',
  };

  const yamlFile = fileMap[resource!];
  if (yamlFile) {
    const data = loadYaml(yamlFile, parsed.namespace);
    if (!data) return { success: false, error: `No ${resource} data` };
    const allItems = data.items || [];
    const items = name ? allItems.filter(item => item.metadata?.name === name) : allItems;
    if (items.length === 0) return { success: false, error: `Error from server (NotFound): ${resource} "${name}" not found` };
    const output = items.map(item => generateGenericDescribe(item)).join('\n\n---\n\n');
    return { success: true, stdout: output };
  }

  return { success: false, error: `[SNAPSHOT] describe not implemented for: ${resource}` };
}

// --- ROLLOUT handler ---

function handleRollout(parsed: ParsedCommand): CommandResult {
  const deployment = parsed.resource;
  let deploymentName = deployment!;
  if (deployment && deployment.includes('/')) {
    deploymentName = deployment.split('/')[1];
  }

  const data = loadYaml('deployments.yaml', parsed.namespace);

  switch (parsed.subAction) {
    case 'status': {
      if (!data) return { success: true, stdout: `deployment "${deploymentName}" successfully rolled out` };
      const item = findItem(data, deploymentName);
      if (!item) return { success: false, error: `Error from server (NotFound): deployments.apps "${deploymentName}" not found` };
      const status = (item.status || {}) as Record<string, unknown>;
      const spec = (item.spec || {}) as Record<string, unknown>;
      const ready = (status.readyReplicas as number) || 0;
      const desired = (spec.replicas as number) || 1;
      if (ready >= desired) {
        return { success: true, stdout: `deployment "${deploymentName}" successfully rolled out` };
      }
      return { success: true, stdout: `Waiting for deployment "${deploymentName}" rollout to finish: ${ready} of ${desired} updated replicas are available...` };
    }
    case 'history': {
      const revision = parsed.flags.revision as string | undefined;
      if (revision) {
        const item = data ? findItem(data, deploymentName) : null;
        const spec = (item?.spec || {}) as Record<string, unknown>;
        const template = (spec.template || {}) as Record<string, unknown>;
        const templateSpec = (template.spec || {}) as Record<string, unknown>;
        const containers = (templateSpec.containers || []) as Array<Record<string, unknown>>;
        const image = (containers[0]?.image as string) || 'unknown:latest';
        return {
          success: true,
          stdout: `deployment.apps/${deploymentName} with revision #${revision}\nPod Template:\n  Labels:  app=${deploymentName}\n  Containers:\n   ${deploymentName}:\n    Image: ${image}\n    Port:  <none>\n    Host Port: <none>\n    Environment: <none>\n    Mounts: <none>\n  Volumes: <none>`
        };
      }
      return {
        success: true,
        stdout: `deployment.apps/${deploymentName}\nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>\n3         kubectl set image deployment/${deploymentName} ${deploymentName}=image:v2\n4         kubectl set image deployment/${deploymentName} ${deploymentName}=image:v3`
      };
    }
    case 'undo':
      return { success: true, stdout: `deployment.apps/${deploymentName} rolled back` };
    case 'pause':
      return { success: true, stdout: `deployment.apps/${deploymentName} paused` };
    case 'resume':
      return { success: true, stdout: `deployment.apps/${deploymentName} resumed` };
    case 'restart':
      return { success: true, stdout: `deployment.apps/${deploymentName} restarted` };
    default:
      return { success: false, error: `[SNAPSHOT] Unsupported rollout action: ${parsed.subAction}` };
  }
}

// --- CONFIG handler ---

function handleConfig(parsed: ParsedCommand): CommandResult {
  switch (parsed.subAction) {
    case 'current-context':
      return { success: true, stdout: 'snapshot-context' };
    case 'get-contexts':
      return {
        success: true,
        stdout: `CURRENT   NAME                 CLUSTER              AUTHINFO             NAMESPACE\n*         snapshot-context     snapshot-cluster     snapshot-user        ${DEFAULT_NAMESPACE}`
      };
    default:
      return { success: false, error: `[SNAPSHOT] Unsupported config action: ${parsed.subAction}` };
  }
}

// --- LOGS handler ---

function handleLogs(parsed: ParsedCommand): CommandResult {
  const podName = parsed.resource;
  return {
    success: true,
    stdout: `[SNAPSHOT] Log output for pod ${podName} in namespace ${parsed.namespace || DEFAULT_NAMESPACE}\n` +
      `2026-02-13T12:00:00Z INFO  Application started\n` +
      `2026-02-13T12:00:01Z INFO  Listening on port 8080\n` +
      `2026-02-13T12:00:05Z INFO  Health check passed\n` +
      `2026-02-13T12:01:00Z INFO  Request received: GET /api/status\n` +
      `2026-02-13T12:01:00Z INFO  Response sent: 200 OK\n` +
      `2026-02-13T12:05:00Z INFO  Health check passed`
  };
}

// --- SET handler ---

function handleSet(parsed: ParsedCommand): CommandResult {
  if (parsed.subAction === 'image') {
    return { success: true, stdout: `deployment.apps/${parsed.resource || 'unknown'} image updated (snapshot)` };
  }
  return { success: false, error: `[SNAPSHOT] Unsupported set action: ${parsed.subAction}` };
}
