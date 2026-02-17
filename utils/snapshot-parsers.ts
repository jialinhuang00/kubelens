/**
 * Snapshot parsers — helpers, table generators, and describe generators
 * for formatting kubectl-like output from snapshot data.
 */

import { loadText, DEFAULT_NAMESPACE } from './snapshot-loader';
import type { K8sItem, K8sList } from './snapshot-loader';

// --- Helpers ---

export function extractNames(yamlData: K8sList | null): string[] {
  if (!yamlData || !yamlData.items) return [];
  return yamlData.items.map(item => item.metadata?.name).filter(Boolean) as string[];
}

export function findItem(yamlData: K8sList | null, name: string): K8sItem | null {
  if (!yamlData || !yamlData.items) return null;
  return yamlData.items.find(item => item.metadata?.name === name) || null;
}

export function pad(str: unknown, len: number): string {
  const s = String(str || '');
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

export function getAge(timestamp: string | undefined): string {
  if (!timestamp) return '<unknown>';
  const diff = Date.now() - new Date(timestamp).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / 60000);
  return `${minutes}m`;
}

export function getDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${secs % 60}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

// --- Tabular generators ---

export function generateDeploymentTable(items: K8sItem[]): string {
  const header = 'NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE';
  const rows = items.map(d => {
    const name = d.metadata.name;
    const desired = (d.spec as Record<string, unknown>)?.replicas as number || 1;
    const status = d.status as Record<string, unknown> || {};
    const ready = (status.readyReplicas as number) || 0;
    const upToDate = (status.updatedReplicas as number) || 0;
    const available = (status.availableReplicas as number) || 0;
    const age = getAge(d.metadata.creationTimestamp);
    return `${pad(name, 38)}${pad(`${ready}/${desired}`, 8)}${pad(String(upToDate), 13)}${pad(String(available), 12)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateServiceTable(items: K8sItem[]): string {
  const header = 'NAME                            TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)                      AGE';
  const rows = items.map(s => {
    const name = s.metadata.name;
    const spec = (s.spec || {}) as Record<string, unknown>;
    const type = (spec.type as string) || 'ClusterIP';
    const clusterIP = (spec.clusterIP as string) || '<none>';
    const externalIP = ((spec.externalIPs as string[]) || []).join(',') || '<none>';
    const ports = ((spec.ports as Array<Record<string, unknown>>) || []).map(p => {
      if (p.nodePort) return `${p.port}:${p.nodePort}/${(p.protocol as string) || 'TCP'}`;
      return `${p.port}/${(p.protocol as string) || 'TCP'}`;
    }).join(',') || '<none>';
    const age = getAge(s.metadata.creationTimestamp);
    return `${pad(name, 32)}${pad(type, 12)}${pad(clusterIP, 17)}${pad(externalIP, 14)}${pad(ports, 29)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateCronjobTable(items: K8sItem[]): string {
  const header = 'NAME                           SCHEDULE       SUSPEND   ACTIVE   LAST SCHEDULE   AGE';
  const rows = items.map(c => {
    const name = c.metadata.name;
    const spec = (c.spec || {}) as Record<string, unknown>;
    const status = (c.status || {}) as Record<string, unknown>;
    const schedule = (spec.schedule as string) || '* * * * *';
    const suspend = spec.suspend ? 'True' : 'False';
    const active = ((status.active as unknown[]) || []).length;
    const lastSchedule = status.lastScheduleTime ? getAge(status.lastScheduleTime as string) : '<none>';
    const age = getAge(c.metadata.creationTimestamp);
    return `${pad(name, 31)}${pad(schedule, 15)}${pad(suspend, 10)}${pad(String(active), 9)}${pad(lastSchedule, 16)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateStatefulsetTable(items: K8sItem[]): string {
  const header = 'NAME                  READY   AGE';
  const rows = items.map(s => {
    const name = s.metadata.name;
    const desired = (s.spec as Record<string, unknown>)?.replicas as number || 1;
    const ready = (s.status as Record<string, unknown>)?.readyReplicas as number || 0;
    const age = getAge(s.metadata.creationTimestamp);
    return `${pad(name, 22)}${pad(`${ready}/${desired}`, 8)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateJobTable(items: K8sItem[]): string {
  const header = 'NAME                               COMPLETIONS   DURATION   AGE';
  const rows = items.map(j => {
    const name = j.metadata.name;
    const spec = (j.spec || {}) as Record<string, unknown>;
    const status = (j.status || {}) as Record<string, unknown>;
    const succeeded = (status.succeeded as number) || 0;
    const completions = (spec.completions as number) || 1;
    const duration = status.completionTime && status.startTime
      ? getDuration(status.startTime as string, status.completionTime as string)
      : '<none>';
    const age = getAge(j.metadata.creationTimestamp);
    return `${pad(name, 35)}${pad(`${succeeded}/${completions}`, 14)}${pad(duration, 11)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateConfigmapTable(items: K8sItem[]): string {
  const header = 'NAME                              DATA   AGE';
  const rows = items.map(c => {
    const name = c.metadata.name;
    const dataCount = c.data ? Object.keys(c.data).length : 0;
    const age = getAge(c.metadata.creationTimestamp);
    return `${pad(name, 34)}${pad(String(dataCount), 7)}${age}`;
  });
  return [header, ...rows].join('\n');
}

export function generateEndpointTable(items: K8sItem[]): string {
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

export function generateDeploymentDescribe(item: K8sItem | null): string {
  if (!item) return 'Error from server (NotFound): deployments.apps not found';
  const m = item.metadata;
  const s = (item.spec || {}) as Record<string, unknown>;
  const st = (item.status || {}) as Record<string, unknown>;
  const labels = Object.entries(m.labels || {}).map(([k, v]) => `                   ${k}=${v}`).join('\n');
  const annotations = Object.entries(m.annotations || {}).map(([k, v]) => `                   ${k}: ${v}`).join('\n');
  const template = (s.template || {}) as Record<string, unknown>;
  const templateSpec = (template.spec || {}) as Record<string, unknown>;
  const containers = ((templateSpec.containers || []) as Array<Record<string, unknown>>).map(c => {
    const envLines = ((c.env || []) as Array<Record<string, unknown>>).map(e => `      ${e.name}:  ${e.value || '<set to the key>'}`).join('\n');
    const resources = (c.resources || {}) as Record<string, unknown>;
    const containerPorts = ((c.ports || []) as Array<Record<string, unknown>>).map(p => `${p.containerPort}/${(p.protocol as string) || 'TCP'}`).join(', ') || '<none>';
    return `  ${c.name}:\n    Image:      ${c.image}\n    Port:       ${containerPorts}\n    Limits:     ${JSON.stringify(resources.limits || {})}\n    Requests:   ${JSON.stringify(resources.requests || {})}\n    Environment:\n${envLines || '      <none>'}`;
  }).join('\n');

  const conditions = ((st.conditions || []) as Array<Record<string, unknown>>).map(c =>
    `  ${pad(c.type, 20)}${pad(c.status, 8)}${pad((c.reason as string) || '', 25)}${(c.message as string) || ''}`
  ).join('\n');

  const selector = (s.selector || {}) as Record<string, unknown>;
  const matchLabels = (selector.matchLabels || {}) as Record<string, string>;
  const templateMeta = (template.metadata || {}) as Record<string, unknown>;
  const templateLabels = (templateMeta.labels || {}) as Record<string, string>;
  const strategy = (s.strategy || {}) as Record<string, unknown>;

  return `Name:                   ${m.name}
Namespace:              ${m.namespace}
CreationTimestamp:      ${m.creationTimestamp}
Labels:
${labels}
Annotations:
${annotations}
Selector:               ${Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',')}
Replicas:               ${s.replicas} desired | ${st.updatedReplicas || 0} updated | ${st.replicas || 0} total | ${st.readyReplicas || 0} ready | ${st.unavailableReplicas || 0} unavailable
StrategyType:           ${(strategy.type as string) || 'RollingUpdate'}
Pod Template:
  Labels:  ${Object.entries(templateLabels).map(([k, v]) => `${k}=${v}`).join('\n           ')}
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

export function generatePodDescribe(podName: string, namespace?: string): string {
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

export function generateServiceDescribe(item: K8sItem | null): string {
  if (!item) return 'Error from server (NotFound): services not found';
  const m = item.metadata;
  const s = (item.spec || {}) as Record<string, unknown>;
  const sPorts = ((s.ports || []) as Array<Record<string, unknown>>).map(p =>
    `  Port:              ${(p.name as string) || '<unset>'}  ${p.port}/${(p.protocol as string) || 'TCP'}\n  TargetPort:        ${p.targetPort}/${(p.protocol as string) || 'TCP'}`
  ).join('\n');
  const selector = Object.entries((s.selector || {}) as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(',');
  return `Name:              ${m.name}
Namespace:         ${m.namespace}
Labels:            ${Object.entries(m.labels || {}).map(([k, v]) => `${k}=${v}`).join('\n                   ')}
Selector:          ${selector || '<none>'}
Type:              ${(s.type as string) || 'ClusterIP'}
IP:                ${(s.clusterIP as string) || '<none>'}
${sPorts}
Session Affinity:  ${(s.sessionAffinity as string) || 'None'}
Events:            <none>`;
}

export function generateGenericDescribe(item: K8sItem | null): string {
  if (!item) return 'Error from server (NotFound): resource not found';
  const m = item.metadata || {} as Record<string, unknown>;
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
