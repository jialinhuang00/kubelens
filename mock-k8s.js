/**
 * Mock K8s data interceptor.
 * Reads backup YAML files and returns pre-baked responses for kubectl commands.
 *
 * Usage: MOCK_K8S=true node server-legacy.js
 * Set MOCK_K8S_DATA to override the backup data path.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_DATA_PATH = path.join(
  __dirname,
  'mock-data'
);

const DATA_PATH = process.env.MOCK_K8S_DATA || DEFAULT_DATA_PATH;
const MOCK_NAMESPACE = 'demo';

// --- Cache loaded YAML ---
const cache = {};

function loadYaml(filename) {
  if (cache[filename]) return cache[filename];
  const filePath = path.join(DATA_PATH, filename);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(content);
  cache[filename] = parsed;
  return parsed;
}

function loadText(filename) {
  const key = `text:${filename}`;
  if (cache[key]) return cache[key];
  const filePath = path.join(DATA_PATH, filename);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  cache[key] = content;
  return content;
}

// --- Helpers ---

function extractNames(yamlData) {
  if (!yamlData || !yamlData.items) return [];
  return yamlData.items.map(item => item.metadata?.name).filter(Boolean);
}

function findItem(yamlData, name) {
  if (!yamlData || !yamlData.items) return null;
  return yamlData.items.find(item => item.metadata?.name === name) || null;
}

function pad(str, len) {
  str = String(str || '');
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// --- Tabular generators ---

function generateDeploymentTable(items) {
  const header = 'NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE';
  const rows = items.map(d => {
    const name = d.metadata.name;
    const desired = d.spec?.replicas || 1;
    const ready = d.status?.readyReplicas || 0;
    const upToDate = d.status?.updatedReplicas || 0;
    const available = d.status?.availableReplicas || 0;
    const age = getAge(d.metadata.creationTimestamp);
    return `${pad(name, 38)}${pad(`${ready}/${desired}`, 8)}${pad(String(upToDate), 13)}${pad(String(available), 12)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateServiceTable(items) {
  const header = 'NAME                            TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)                      AGE';
  const rows = items.map(s => {
    const name = s.metadata.name;
    const type = s.spec?.type || 'ClusterIP';
    const clusterIP = s.spec?.clusterIP || '<none>';
    const externalIP = (s.spec?.externalIPs || []).join(',') || '<none>';
    const ports = (s.spec?.ports || []).map(p => {
      if (p.nodePort) return `${p.port}:${p.nodePort}/${p.protocol || 'TCP'}`;
      return `${p.port}/${p.protocol || 'TCP'}`;
    }).join(',') || '<none>';
    const age = getAge(s.metadata.creationTimestamp);
    return `${pad(name, 32)}${pad(type, 12)}${pad(clusterIP, 17)}${pad(externalIP, 14)}${pad(ports, 29)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateCronjobTable(items) {
  const header = 'NAME                           SCHEDULE       SUSPEND   ACTIVE   LAST SCHEDULE   AGE';
  const rows = items.map(c => {
    const name = c.metadata.name;
    const schedule = c.spec?.schedule || '* * * * *';
    const suspend = c.spec?.suspend ? 'True' : 'False';
    const active = (c.status?.active || []).length;
    const lastSchedule = c.status?.lastScheduleTime ? getAge(c.status.lastScheduleTime) : '<none>';
    const age = getAge(c.metadata.creationTimestamp);
    return `${pad(name, 31)}${pad(schedule, 15)}${pad(suspend, 10)}${pad(String(active), 9)}${pad(lastSchedule, 16)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateStatefulsetTable(items) {
  const header = 'NAME                  READY   AGE';
  const rows = items.map(s => {
    const name = s.metadata.name;
    const desired = s.spec?.replicas || 1;
    const ready = s.status?.readyReplicas || 0;
    const age = getAge(s.metadata.creationTimestamp);
    return `${pad(name, 22)}${pad(`${ready}/${desired}`, 8)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateJobTable(items) {
  const header = 'NAME                               COMPLETIONS   DURATION   AGE';
  const rows = items.map(j => {
    const name = j.metadata.name;
    const succeeded = j.status?.succeeded || 0;
    const completions = j.spec?.completions || 1;
    const duration = j.status?.completionTime && j.status?.startTime
      ? getDuration(j.status.startTime, j.status.completionTime)
      : '<none>';
    const age = getAge(j.metadata.creationTimestamp);
    return `${pad(name, 35)}${pad(`${succeeded}/${completions}`, 14)}${pad(duration, 11)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateConfigmapTable(items) {
  const header = 'NAME                              DATA   AGE';
  const rows = items.map(c => {
    const name = c.metadata.name;
    const dataCount = c.data ? Object.keys(c.data).length : 0;
    const age = getAge(c.metadata.creationTimestamp);
    return `${pad(name, 34)}${pad(String(dataCount), 7)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function generateEndpointTable(items) {
  const header = 'NAME                            ENDPOINTS                          AGE';
  const rows = items.map(e => {
    const name = e.metadata.name;
    const endpoints = (e.subsets || []).flatMap(s =>
      (s.addresses || []).flatMap(a =>
        (s.ports || []).map(p => `${a.ip}:${p.port}`)
      )
    ).slice(0, 3).join(',') || '<none>';
    const suffix = (e.subsets || []).flatMap(s => s.addresses || []).length > 3 ? ' + more...' : '';
    const age = getAge(e.metadata.creationTimestamp);
    return `${pad(name, 32)}${pad(endpoints + suffix, 35)}${age}`;
  });
  return [header, ...rows].join('\n');
}

function getAge(timestamp) {
  if (!timestamp) return '<unknown>';
  const diff = Date.now() - new Date(timestamp).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

function getDuration(start, end) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${secs % 60}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

// --- Describe generator ---

function generateDeploymentDescribe(item) {
  if (!item) return 'Error from server (NotFound): deployments.apps not found';
  const m = item.metadata;
  const s = item.spec;
  const st = item.status;
  const labels = Object.entries(m.labels || {}).map(([k, v]) => `                   ${k}=${v}`).join('\n');
  const annotations = Object.entries(m.annotations || {}).map(([k, v]) => `                   ${k}: ${v}`).join('\n');
  const containers = (s.template?.spec?.containers || []).map(c => {
    const envLines = (c.env || []).map(e => `      ${e.name}:  ${e.value || '<set to the key>'}`).join('\n');
    return `  ${c.name}:\n    Image:      ${c.image}\n    Port:       ${(c.ports || []).map(p => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', ') || '<none>'}\n    Limits:     ${JSON.stringify(c.resources?.limits || {})}\n    Requests:   ${JSON.stringify(c.resources?.requests || {})}\n    Environment:\n${envLines || '      <none>'}`;
  }).join('\n');

  const conditions = (st.conditions || []).map(c =>
    `  ${pad(c.type, 20)}${pad(c.status, 8)}${pad(c.reason || '', 25)}${c.message || ''}`
  ).join('\n');

  return `Name:                   ${m.name}
Namespace:              ${m.namespace}
CreationTimestamp:      ${m.creationTimestamp}
Labels:
${labels}
Annotations:
${annotations}
Selector:               ${Object.entries(s.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',')}
Replicas:               ${s.replicas} desired | ${st.updatedReplicas || 0} updated | ${st.replicas || 0} total | ${st.readyReplicas || 0} ready | ${st.unavailableReplicas || 0} unavailable
StrategyType:           ${s.strategy?.type || 'RollingUpdate'}
Pod Template:
  Labels:  ${Object.entries(s.template?.metadata?.labels || {}).map(([k, v]) => `${k}=${v}`).join('\n           ')}
  Containers:
${containers}
Conditions:
  Type                Status  Reason                   Message
  ----                ------  ------                   -------
${conditions}
OldReplicaSets:       <none>
NewReplicaSet:        ${m.name} (${st.readyReplicas || 0}/${s.replicas} replicas created)
Events:               <none>`;
}

function generatePodDescribe(podName) {
  // We don't have full pod YAML, generate a basic describe from pods-snapshot
  const snapshot = loadText('pods-snapshot.txt');
  if (!snapshot) return `Error from server (NotFound): pods "${podName}" not found`;
  const lines = snapshot.trim().split('\n');
  const podLine = lines.find(l => l.trim().startsWith(podName));
  if (!podLine) return `Error from server (NotFound): pods "${podName}" not found`;
  const parts = podLine.trim().split(/\s+/);
  // NAME READY STATUS RESTARTS AGE IP NODE NOMINATED READINESS
  return `Name:             ${parts[0]}
Namespace:        ${MOCK_NAMESPACE}
Node:             ${parts[6] || '<unknown>'}
Status:           ${parts[2]}
IP:               ${parts[5] || '<none>'}
Containers:
  main:
    Ready:          ${parts[1]}
    Restart Count:  ${parts[3]}
Conditions:
  Type              Status
  Initialized       True
  Ready             ${parts[2] === 'Running' ? 'True' : 'False'}
  ContainersReady   ${parts[2] === 'Running' ? 'True' : 'False'}
  PodScheduled      True
Events:             <none>`;
}

function generateServiceDescribe(item) {
  if (!item) return 'Error from server (NotFound): services not found';
  const m = item.metadata;
  const s = item.spec;
  const ports = (s.ports || []).map(p =>
    `  Port:              ${p.name || '<unset>'}  ${p.port}/${p.protocol || 'TCP'}\n  TargetPort:        ${p.targetPort}/${p.protocol || 'TCP'}`
  ).join('\n');
  const selector = Object.entries(s.selector || {}).map(([k, v]) => `${k}=${v}`).join(',');
  return `Name:              ${m.name}
Namespace:         ${m.namespace}
Labels:            ${Object.entries(m.labels || {}).map(([k, v]) => `${k}=${v}`).join('\n                   ')}
Selector:          ${selector || '<none>'}
Type:              ${s.type || 'ClusterIP'}
IP:                ${s.clusterIP || '<none>'}
${ports}
Session Affinity:  ${s.sessionAffinity || 'None'}
Events:            <none>`;
}

// --- Resource mapping ---
const RESOURCE_FILE_MAP = {
  'deployments': 'deployments.yaml',
  'deployment': 'deployments.yaml',
  'deploy': 'deployments.yaml',
  'services': 'services.yaml',
  'service': 'services.yaml',
  'svc': 'services.yaml',
  'pods': null, // pods use snapshot text
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

const TABLE_GENERATORS = {
  'deployments.yaml': generateDeploymentTable,
  'services.yaml': generateServiceTable,
  'cronjobs.yaml': generateCronjobTable,
  'statefulsets.yaml': generateStatefulsetTable,
  'jobs.yaml': generateJobTable,
  'configmaps.yaml': generateConfigmapTable,
  'endpoints.yaml': generateEndpointTable,
};

// --- Command parser ---

function parseKubectlCommand(command) {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== 'kubectl') return null;

  const result = {
    action: null,     // get, describe, logs, rollout, config, exec, delete, ...
    subAction: null,  // for rollout: status, history, undo, pause, resume, restart
    resource: null,   // pods, deployments, services, ...
    resourceName: null, // specific resource name
    namespace: null,
    output: null,     // json, yaml, wide, jsonpath, custom-columns
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

    // Handle sub-actions like "rollout status", "config current-context", "set image"
    if ((result.action === 'rollout' || result.action === 'config' || result.action === 'set') && !result.subAction) {
      result.subAction = part;
      i++;
      continue;
    }

    if (part === '-n' || part === '--namespace') {
      result.namespace = parts[i + 1];
      i += 2;
      continue;
    }

    if (part === '-o' || part === '--output') {
      result.output = parts[i + 1];
      // Handle quoted output like 'custom-columns=...'
      if (result.output && result.output.startsWith('"')) {
        // Collect until closing quote
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

    // Handle -o format combined like -ojson
    if (part.startsWith('-o') && part.length > 2) {
      result.output = part.substring(2);
      i++;
      continue;
    }

    // Handle flags like --tail=50, --sort-by=..., --no-headers, --all-namespaces, -A
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

    // Positional args: resource type, then resource name
    if (!result.resource) {
      result.resource = part;
    } else if (!result.resourceName) {
      result.resourceName = part;
    }
    i++;
  }

  // Handle "get all"
  if (result.resource === 'all') {
    result.flags.getAll = true;
  }

  return result;
}

// --- Main handler ---

function handleCommand(command) {
  const parsed = parseKubectlCommand(command);
  if (!parsed) {
    return { success: false, error: 'Failed to parse command' };
  }

  console.log(`[MOCK] Handling: ${command}`);
  console.log(`[MOCK] Parsed:`, JSON.stringify(parsed, null, 2));

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
        return { success: false, error: '[MOCK] exec is not supported in mock mode' };
      case 'delete':
        return { success: false, error: '[MOCK] delete is not supported in mock mode (read-only)' };
      case 'set':
        return handleSet(parsed);
      case 'port-forward':
        return { success: false, error: '[MOCK] port-forward is not supported in mock mode' };
      case 'patch':
        return { success: true, stdout: `service/${parsed.resourceName || 'unknown'} patched (mock)` };
      case 'run':
        return { success: true, stdout: 'pod/test-connectivity created (mock)\nConnection successful' };
      case 'apply':
        return { success: true, stdout: 'resource applied (mock)' };
      default:
        return { success: false, error: `[MOCK] Unsupported action: ${parsed.action}` };
    }
  } catch (err) {
    console.error('[MOCK] Error:', err);
    return { success: false, error: `[MOCK] Error: ${err.message}` };
  }
}

// --- GET handler ---

function handleGet(parsed) {
  // kubectl get all
  if (parsed.flags.getAll) {
    return handleGetAll(parsed);
  }

  // Namespace listing
  if (['namespaces', 'namespace', 'ns'].includes(parsed.resource)) {
    return handleGetNamespaces(parsed);
  }

  // Nodes
  if (['nodes', 'node'].includes(parsed.resource)) {
    return handleGetNodes(parsed);
  }

  // Events
  if (['events', 'event', 'ev'].includes(parsed.resource)) {
    return handleGetEvents(parsed);
  }

  // Pods (special: use snapshot text)
  if (['pods', 'pod'].includes(parsed.resource)) {
    return handleGetPods(parsed);
  }

  // Replicasets (not in backup, generate from deployments)
  if (['replicasets', 'replicaset', 'rs'].includes(parsed.resource)) {
    return handleGetReplicasets(parsed);
  }

  // Generic YAML-backed resources
  const yamlFile = RESOURCE_FILE_MAP[parsed.resource];
  if (!yamlFile) {
    return { success: false, error: `[MOCK] Unknown resource type: ${parsed.resource}` };
  }

  const data = loadYaml(yamlFile);
  if (!data) {
    return { success: false, error: `[MOCK] No backup data for ${parsed.resource}` };
  }

  // Single resource by name
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
    // Default: table with single item
    const generator = TABLE_GENERATORS[yamlFile];
    if (generator) {
      return { success: true, stdout: generator([item]) };
    }
    return { success: true, stdout: yaml.dump(item) };
  }

  // List: check output format
  const items = data.items || [];

  // jsonpath for names
  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const jsonpath = parsed.output.replace('jsonpath=', '').replace(/^"|"$/g, '');
    if (jsonpath.includes('.metadata.name')) {
      return { success: true, stdout: extractNames(data).join(' ') };
    }
    // fallback: return names
    return { success: true, stdout: extractNames(data).join(' ') };
  }

  if (parsed.output === 'json') {
    return { success: true, stdout: JSON.stringify(data, null, 2) };
  }

  if (parsed.output === 'yaml') {
    return { success: true, stdout: yaml.dump(data) };
  }

  // custom-columns
  if (parsed.output && parsed.output.startsWith('custom-columns=')) {
    return handleCustomColumns(parsed, items);
  }

  // Default: tabular
  const generator = TABLE_GENERATORS[yamlFile];
  if (generator) {
    let output = generator(items);
    if (parsed.flags.noHeaders) {
      output = output.split('\n').slice(1).join('\n');
    }
    return { success: true, stdout: output };
  }

  // Fallback: just list names
  return { success: true, stdout: extractNames(data).join('\n') };
}

function handleGetNamespaces(parsed) {
  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    return { success: true, stdout: MOCK_NAMESPACE };
  }
  if (parsed.output === 'json') {
    return {
      success: true,
      stdout: JSON.stringify({
        apiVersion: 'v1',
        kind: 'NamespaceList',
        items: [{ metadata: { name: MOCK_NAMESPACE }, status: { phase: 'Active' } }]
      }, null, 2)
    };
  }
  const header = 'NAME     STATUS   AGE';
  const row = `${pad(MOCK_NAMESPACE, 9)}Active   200d`;
  let output = [header, row].join('\n');
  if (parsed.flags.noHeaders) output = row;
  return { success: true, stdout: output };
}

function handleGetNodes(parsed) {
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

function handleGetPods(parsed) {
  // Single pod by name
  if (parsed.resourceName) {
    const snapshot = loadText('pods-snapshot.txt');
    if (!snapshot) return { success: false, error: 'No pod data available' };
    const lines = snapshot.trim().split('\n');
    const header = lines[0];
    const podLine = lines.find(l => l.trim().startsWith(parsed.resourceName));
    if (!podLine) return { success: false, error: `Error from server (NotFound): pods "${parsed.resourceName}" not found` };

    if (parsed.output === 'json') {
      // Generate a basic pod JSON from snapshot line
      const parts = podLine.trim().split(/\s+/);
      const podJson = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: parts[0], namespace: MOCK_NAMESPACE },
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
      // Enrich with image data from pods-images.txt
      const images = loadText('pods-images.txt');
      if (images) {
        const imgLine = images.trim().split('\n').find(l => l.trim().startsWith(parts[0]));
        if (imgLine) {
          const imgParts = imgLine.trim().split(/\s+/);
          const imageStr = imgParts.slice(1).join(' ');
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
      return { success: true, stdout: JSON.stringify(podJson, null, 2) };
    }

    if (parsed.flags.noHeaders) return { success: true, stdout: podLine };
    return { success: true, stdout: [header, podLine].join('\n') };
  }

  // List all pods
  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const snapshot = loadText('pods-snapshot.txt');
    if (!snapshot) return { success: true, stdout: '' };
    const lines = snapshot.trim().split('\n').slice(1); // skip header
    const names = lines.map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    return { success: true, stdout: names.join(' ') };
  }

  // custom-columns for pods (e.g., POD_NAME:.metadata.name,IMAGE:...)
  if (parsed.output && (parsed.output.startsWith('custom-columns=') || parsed.output.startsWith('"custom-columns='))) {
    const cleanOutput = parsed.output.replace(/^"|"$/g, '');
    if (cleanOutput.includes('IMAGE') || cleanOutput.includes('image')) {
      const imagesText = loadText('pods-images.txt');
      if (imagesText) {
        let output = imagesText;
        if (parsed.flags.noHeaders) {
          output = imagesText.split('\n').slice(1).join('\n');
        }
        return { success: true, stdout: output.trim() };
      }
    }
    // fallback to snapshot
    const snapshot = loadText('pods-snapshot.txt');
    if (snapshot) return { success: true, stdout: snapshot.trim() };
    return { success: true, stdout: '' };
  }

  // Default table
  const snapshot = loadText('pods-snapshot.txt');
  if (!snapshot) return { success: true, stdout: 'No resources found in namespace.' };

  let output = snapshot.trim();
  if (parsed.flags.noHeaders) {
    output = output.split('\n').slice(1).join('\n');
  }
  return { success: true, stdout: output };
}

function handleGetReplicasets(parsed) {
  // Generate from deployments
  const data = loadYaml('deployments.yaml');
  if (!data) return { success: true, stdout: 'No resources found.' };

  if (parsed.output && parsed.output.startsWith('jsonpath=')) {
    const names = (data.items || []).map(d => `${d.metadata.name}-${d.metadata.generation || '1'}`);
    return { success: true, stdout: names.join(' ') };
  }

  if (parsed.output && parsed.output.startsWith('custom-columns=')) {
    // Generate replicaset custom-columns output
    const header = 'REPLICASET                                    DEPLOYMENT                          DESIRED   CURRENT   READY';
    const rows = (data.items || []).map(d => {
      const rsName = `${d.metadata.name}-${(d.spec?.template?.metadata?.labels?.['pod-template-hash'] || 'abc123').substring(0, 10)}`;
      return `${pad(rsName, 46)}${pad(d.metadata.name, 36)}${pad(String(d.spec?.replicas || 1), 10)}${pad(String(d.status?.replicas || 0), 10)}${d.status?.readyReplicas || 0}`;
    });
    let output = [header, ...rows].join('\n');
    if (parsed.flags.noHeaders) output = rows.join('\n');
    return { success: true, stdout: output };
  }

  const header = 'NAME                                          DESIRED   CURRENT   READY   AGE';
  const rows = (data.items || []).map(d => {
    const rsName = `${d.metadata.name}-${String(d.metadata.generation || '1').padStart(2, '0')}`;
    return `${pad(rsName, 46)}${pad(String(d.spec?.replicas || 1), 10)}${pad(String(d.status?.replicas || 0), 10)}${pad(String(d.status?.readyReplicas || 0), 8)}${getAge(d.metadata.creationTimestamp)}`;
  });
  let output = [header, ...rows].join('\n');
  if (parsed.flags.noHeaders) output = rows.join('\n');
  return { success: true, stdout: output };
}

function handleGetEvents(parsed) {
  // Mock some events
  const now = new Date().toISOString();
  const events = [
    `LAST SEEN   TYPE      REASON              OBJECT                                        MESSAGE`,
    `3m          Normal    Scheduled           pod/web-app-7449d97884-j7bt5                    Successfully assigned ${MOCK_NAMESPACE}/web-app-7449d97884-j7bt5 to ip-10-0-2-80.ec2.internal`,
    `3m          Normal    Pulled              pod/web-app-7449d97884-j7bt5                    Container image already present on machine`,
    `3m          Normal    Created             pod/web-app-7449d97884-j7bt5                    Created container web-app`,
    `3m          Normal    Started             pod/web-app-7449d97884-j7bt5                    Started container web-app`,
    `10h         Normal    ScalingReplicaSet   deployment/web-app                              Scaled up replica set web-app-7449d97884 to 1`,
    `23h         Normal    ScalingReplicaSet   deployment/api-server               Scaled up replica set api-server-86997f5d7f to 1`,
    `23h         Warning   BackOff             pod/converter-86565f7d48-2v46j            Back-off restarting failed container`,
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

function handleGetAll(parsed) {
  const ns = parsed.namespace || MOCK_NAMESPACE;
  const parts = [];

  // Pods
  const snapshot = loadText('pods-snapshot.txt');
  if (snapshot) {
    const lines = snapshot.trim().split('\n');
    const header = lines[0];
    const podLines = lines.slice(1).map(l => `pod/${l.trim().split(/\s+/)[0]}   ${l.trim().split(/\s+/).slice(1).join('   ')}`);
    parts.push(`=== POD ===\n${header}\n${podLines.join('\n')}`);
  }

  // Deployments
  const deployData = loadYaml('deployments.yaml');
  if (deployData) {
    parts.push(`=== DEPLOYMENT ===\n${generateDeploymentTable(deployData.items || [])}`);
  }

  // Services
  const svcData = loadYaml('services.yaml');
  if (svcData) {
    parts.push(`=== SERVICE ===\n${generateServiceTable(svcData.items || [])}`);
  }

  // Statefulsets
  const stsData = loadYaml('statefulsets.yaml');
  if (stsData) {
    parts.push(`=== STATEFULSET ===\n${generateStatefulsetTable(stsData.items || [])}`);
  }

  // CronJobs
  const cjData = loadYaml('cronjobs.yaml');
  if (cjData) {
    parts.push(`=== CRONJOB ===\n${generateCronjobTable(cjData.items || [])}`);
  }

  // Jobs
  const jobData = loadYaml('jobs.yaml');
  if (jobData) {
    parts.push(`=== JOB ===\n${generateJobTable(jobData.items || [])}`);
  }

  return { success: true, stdout: parts.join('\n\n') };
}

function handleCustomColumns(parsed, items) {
  // Parse custom-columns spec
  const spec = parsed.output.replace('custom-columns=', '').replace(/^"|"$/g, '');
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

function resolveJsonPath(obj, pathStr) {
  if (!pathStr) return '';
  // Simple jsonpath resolution: .metadata.name, .spec.containers[*].image etc.
  const path = pathStr.replace(/^\.(.*)/,'$1');
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current) return '<none>';
    const arrayMatch = part.match(/^(.+)\[\*\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      current = current[key];
      if (Array.isArray(current)) {
        // Return all values joined
        const nextParts = parts.slice(parts.indexOf(part) + 1);
        if (nextParts.length > 0) {
          return current.map(item => {
            let val = item;
            for (const np of nextParts) val = val?.[np];
            return val || '<none>';
          }).join(',');
        }
        return current.join(',');
      }
      return current || '<none>';
    }
    const indexMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (indexMatch) {
      current = current[indexMatch[1]]?.[parseInt(indexMatch[2])];
      continue;
    }
    current = current[part];
  }
  return current !== undefined && current !== null ? current : '<none>';
}

// --- DESCRIBE handler ---

function handleDescribe(parsed) {
  const resource = parsed.resource;
  const name = parsed.resourceName;

  if (['deployment', 'deployments', 'deploy'].includes(resource)) {
    const data = loadYaml('deployments.yaml');
    if (!data) return { success: false, error: 'No deployment data' };
    if (name) {
      const item = findItem(data, name);
      return { success: true, stdout: generateDeploymentDescribe(item) };
    }
    // Describe all
    return {
      success: true,
      stdout: (data.items || []).map(item => generateDeploymentDescribe(item)).join('\n\n---\n\n')
    };
  }

  if (['pod', 'pods'].includes(resource)) {
    if (name) {
      return { success: true, stdout: generatePodDescribe(name) };
    }
    // Describe all pods
    const snapshot = loadText('pods-snapshot.txt');
    if (!snapshot) return { success: false, error: 'No pod data' };
    const names = snapshot.trim().split('\n').slice(1).map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
    return {
      success: true,
      stdout: names.map(n => generatePodDescribe(n)).join('\n\n---\n\n')
    };
  }

  if (['service', 'services', 'svc'].includes(resource)) {
    const data = loadYaml('services.yaml');
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

  return { success: false, error: `[MOCK] describe not implemented for: ${resource}` };
}

// --- ROLLOUT handler ---

function handleRollout(parsed) {
  const deployment = parsed.resource; // deployment name is in resource position for rollout
  const ns = parsed.namespace || MOCK_NAMESPACE;

  // Parse: kubectl rollout status deployment/X -n ns
  let deploymentName = deployment;
  if (deployment && deployment.includes('/')) {
    deploymentName = deployment.split('/')[1];
  }

  const data = loadYaml('deployments.yaml');

  switch (parsed.subAction) {
    case 'status': {
      if (!data) return { success: true, stdout: `deployment "${deploymentName}" successfully rolled out` };
      const item = findItem(data, deploymentName);
      if (!item) return { success: false, error: `Error from server (NotFound): deployments.apps "${deploymentName}" not found` };
      const ready = item.status?.readyReplicas || 0;
      const desired = item.spec?.replicas || 1;
      if (ready >= desired) {
        return { success: true, stdout: `deployment "${deploymentName}" successfully rolled out` };
      }
      return { success: true, stdout: `Waiting for deployment "${deploymentName}" rollout to finish: ${ready} of ${desired} updated replicas are available...` };
    }
    case 'history': {
      // Check for --revision flag
      const revision = parsed.flags.revision;
      if (revision) {
        const item = data ? findItem(data, deploymentName) : null;
        const image = item?.spec?.template?.spec?.containers?.[0]?.image || 'unknown:latest';
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
      return { success: false, error: `[MOCK] Unsupported rollout action: ${parsed.subAction}` };
  }
}

// --- CONFIG handler ---

function handleConfig(parsed) {
  switch (parsed.subAction) {
    case 'current-context':
      return { success: true, stdout: 'arn:aws:eks:us-east-1:REDACTED_ACCOUNT:cluster/demo-dev' };
    case 'get-contexts':
      return {
        success: true,
        stdout: `CURRENT   NAME                                                          CLUSTER                                                       AUTHINFO                                                      NAMESPACE\n*         arn:aws:eks:us-east-1:REDACTED_ACCOUNT:cluster/demo-dev         arn:aws:eks:us-east-1:REDACTED_ACCOUNT:cluster/demo-dev         arn:aws:eks:us-east-1:REDACTED_ACCOUNT:cluster/demo-dev         ${MOCK_NAMESPACE}`
      };
    default:
      return { success: false, error: `[MOCK] Unsupported config action: ${parsed.subAction}` };
  }
}

// --- LOGS handler ---

function handleLogs(parsed) {
  const podName = parsed.resource;
  return {
    success: true,
    stdout: `[MOCK] Log output for pod ${podName} in namespace ${parsed.namespace || MOCK_NAMESPACE}\n` +
      `2026-02-13T12:00:00Z INFO  Application started\n` +
      `2026-02-13T12:00:01Z INFO  Listening on port 8080\n` +
      `2026-02-13T12:00:05Z INFO  Health check passed\n` +
      `2026-02-13T12:01:00Z INFO  Request received: GET /api/status\n` +
      `2026-02-13T12:01:00Z INFO  Response sent: 200 OK\n` +
      `2026-02-13T12:05:00Z INFO  Health check passed`
  };
}

// --- SET handler ---

function handleSet(parsed) {
  if (parsed.subAction === 'image') {
    return { success: true, stdout: `deployment.apps/${parsed.resource || 'unknown'} image updated (mock)` };
  }
  return { success: false, error: `[MOCK] Unsupported set action: ${parsed.subAction}` };
}

// --- Exports ---

module.exports = { handleCommand, parseKubectlCommand };
