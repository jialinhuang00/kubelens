/**
 * Snapshot parsers — helpers, table generators, and describe generators
 * for formatting kubectl-like output from snapshot data.
 */

const { loadText, DEFAULT_NAMESPACE } = require('./snapshot-loader');

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

// --- Describe generators ---

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

function generatePodDescribe(podName, namespace) {
  const ns = namespace || DEFAULT_NAMESPACE;
  const snapshot = loadText('pods-snapshot.txt', ns);
  if (!snapshot) return `Error from server (NotFound): pods "${podName}" not found`;
  const lines = snapshot.trim().split('\n');
  const podLine = lines.find(l => l.trim().startsWith(podName));
  if (!podLine) return `Error from server (NotFound): pods "${podName}" not found`;
  const parts = podLine.trim().split(/\s+/);
  return `Name:             ${parts[0]}
Namespace:        ${ns}
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

function generateGenericDescribe(item) {
  if (!item) return 'Error from server (NotFound): resource not found';
  const m = item.metadata || {};
  const labels = Object.entries(m.labels || {}).map(([k, v]) => `${k}=${v}`).join('\n                   ') || '<none>';
  const annotations = Object.entries(m.annotations || {}).map(([k, v]) => `${k}: ${v}`).join('\n                   ') || '<none>';
  const dataKeys = item.data ? Object.keys(item.data).join('\n  ') : '';
  const dataSection = dataKeys ? `\nData:\n  ${dataKeys}\n` : '';
  return `Name:              ${m.name}
Namespace:         ${m.namespace}
Kind:              ${item.kind || 'Unknown'}
Labels:            ${labels}
Annotations:       ${annotations}
CreationTimestamp: ${m.creationTimestamp || '<unknown>'}${item.type ? `\nType:              ${item.type}` : ''}${dataSection}
Events:            <none>`;
}

module.exports = {
  extractNames,
  findItem,
  pad,
  getAge,
  getDuration,
  generateDeploymentTable,
  generateServiceTable,
  generateCronjobTable,
  generateStatefulsetTable,
  generateJobTable,
  generateConfigmapTable,
  generateEndpointTable,
  generateDeploymentDescribe,
  generatePodDescribe,
  generateServiceDescribe,
  generateGenericDescribe,
};
