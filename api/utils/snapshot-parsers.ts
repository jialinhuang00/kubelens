/**
 * Snapshot parsers — helpers, table generators, and describe generators
 * for formatting kubectl-like output from snapshot data.
 */

import { loadText, DEFAULT_NAMESPACE } from './snapshot-loader';
import type { K8sItem, K8sList } from './snapshot-loader';
import { getTableSpec } from './config-loader';
import type { TableSpec } from './config-loader';

// --- Helpers ---

/**
 * Extract resource names from a K8sList.
 * @param yamlData - Parsed YAML list (e.g. from loadYaml)
 * @returns Array of `metadata.name` strings; empty array if input is null/empty
 * @example
 * extractNames({ items: [{ metadata: { name: 'web' } }, { metadata: { name: 'api' } }] })
 * // → ['web', 'api']
 */
export function extractNames(yamlData: K8sList | null): string[] {
  if (!yamlData || !yamlData.items) return [];
  return yamlData.items.map(item => item.metadata?.name).filter(Boolean) as string[];
}

/**
 * Find a single item by name within a K8sList.
 * @param yamlData - Parsed YAML list
 * @param name - Resource name to match against `metadata.name`
 * @returns The matching K8sItem, or `null` if not found
 * @example
 * findItem(list, 'web') // → { metadata: { name: 'web', ... }, spec: {...} }
 * findItem(list, 'nope') // → null
 */
export function findItem(yamlData: K8sList | null, name: string): K8sItem | null {
  if (!yamlData || !yamlData.items) return null;
  return yamlData.items.find(item => item.metadata?.name === name) || null;
}

/**
 * Right-pad a value to a fixed width with spaces. Used for table column alignment.
 * @param str - Value to pad (coerced to string; null/undefined → '')
 * @param len - Target width
 * @returns Padded string. If input is already >= len, returned as-is (no truncation)
 * @example
 * pad('web', 10)   // → 'web       '
 * pad('toolong', 3) // → 'toolong'
 * pad(42, 5)        // → '42   '
 * pad(null, 3)      // → '   '
 */
export function pad(str: unknown, len: number): string {
  const s = String(str || '');
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

/**
 * Calculate human-readable age from a timestamp to now.
 * @param timestamp - ISO 8601 timestamp (e.g. from `metadata.creationTimestamp`)
 * @returns Age string like `'5d'`, `'3h'`, `'12m'`, or `'<unknown>'` if undefined
 * @example
 * getAge('2026-02-13T00:00:00Z') // → '5d'  (if now is Feb 18)
 * getAge(undefined)               // → '<unknown>'
 */
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

/**
 * Calculate duration between two timestamps.
 * @param start - ISO 8601 start time
 * @param end - ISO 8601 end time
 * @returns Duration string: `'30s'`, `'5m30s'`, or `'2h30m'`
 * @example
 * getDuration('2026-01-01T00:00:00Z', '2026-01-01T00:05:30Z') // → '5m30s'
 * getDuration('2026-01-01T00:00:00Z', '2026-01-01T02:30:00Z') // → '2h30m'
 */
export function getDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${secs % 60}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

// --- Table renderer (config-driven) ---
//
// The per-kind `kubectl get` tables used to be 16 hand-written functions, each
// pad()-ing fixed-width columns. They're now declared as data in
// kubelens.config.yaml's `tables:` block (one column = name + value template +
// width) and rendered by renderTable below. Adding a kind is YAML, not code.
// Only the genuinely computed bits (age, ratios, port lists, …) stay as code,
// exposed as the small transform registries here.

/** Abbreviate PVC access modes the way kubectl does (ReadWriteMany → RWX). */
const ACCESS_MODE_ABBR: Record<string, string> = {
  ReadWriteOnce: 'RWO', ReadOnlyMany: 'ROX', ReadWriteMany: 'RWX', ReadWriteOncePod: 'RWOP',
};

type AnyRecord = Record<string, unknown>;

/** Walk a dotted path (`.spec.template.spec.nodeSelector`) from an item root. */
function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\./, '').split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as AnyRecord)[p];
  }
  return cur;
}

/**
 * Single-field transforms. Receive the resolved field value (+ optional args)
 * and return its display string. A transform that yields '' lets the column's
 * `?fallback` default kick in.
 */
const VALUE_TRANSFORMS: Record<string, (v: unknown, args: string[]) => string> = {
  age: v => (v ? getAge(v as string) : ''),
  count: v => String(Array.isArray(v) ? v.length : 0),
  keys: v => String(v && typeof v === 'object' ? Object.keys(v).length : 0),
  join: (v, a) => (Array.isArray(v) ? v : []).join(a[0] || ','),
  bool: (v, a) => (v ? (a[0] || 'True') : (a[1] || 'False')),
  kv: v => Object.entries((v && typeof v === 'object' ? v : {}) as AnyRecord).map(([k, val]) => `${k}=${val}`).join(','),
  ports: v => (Array.isArray(v) ? v : []).map(p => {
    const port = p as AnyRecord;
    const proto = (port.protocol as string) || 'TCP';
    return port.nodePort ? `${port.port}:${port.nodePort}/${proto}` : `${port.port}/${proto}`;
  }).join(','),
  accessModes: v => (Array.isArray(v) ? v : []).map(m => ACCESS_MODE_ABBR[m as string] || m).join(','),
  ref: (v, a) => {
    const r = (v || {}) as AnyRecord;
    return `${(r.kind as string) || a[0] || ''}/${(r.name as string) || ''}`;
  },
};

/**
 * Whole-item transforms for columns that can't be a single path: they read
 * several fields or apply cross-field logic. Invoked via `{|name}`.
 */
const ITEM_TRANSFORMS: Record<string, (item: K8sItem) => string> = {
  jobDuration: j => {
    const st = (j.status || {}) as AnyRecord;
    return st.completionTime && st.startTime
      ? getDuration(st.startTime as string, st.completionTime as string)
      : '<none>';
  },
  endpoints: e => {
    const eps = (e.subsets || []).flatMap(s =>
      (s.addresses || []).flatMap(a => (s.ports || []).map(p => `${a.ip}:${p.port}`))
    ).slice(0, 3).join(',') || '<none>';
    const suffix = (e.subsets || []).flatMap(s => s.addresses || []).length > 3 ? ' + more...' : '';
    return eps + suffix;
  },
  ingressHosts: i => {
    const rules = (((i.spec || {}) as AnyRecord).rules as AnyRecord[]) || [];
    return rules.map(r => r.host as string).filter(Boolean).join(',') || '*';
  },
  ingressAddress: i => {
    const lb = ((((i.status || {}) as AnyRecord).loadBalancer || {}) as AnyRecord).ingress as AnyRecord[] || [];
    return lb.map(a => (a.hostname as string) || (a.ip as string)).filter(Boolean).join(',');
  },
  ingressPorts: i => (((i.spec || {}) as AnyRecord).tls ? '80, 443' : '80'),
  hpaTargets: h => {
    const spec = (h.spec || {}) as AnyRecord;
    const status = (h.status || {}) as AnyRecord;
    const specMetric = ((spec.metrics as AnyRecord[]) || [])[0]?.resource as AnyRecord | undefined;
    const curMetric = ((status.currentMetrics as AnyRecord[]) || [])[0]?.resource as AnyRecord | undefined;
    const target = ((specMetric?.target || {}) as AnyRecord).averageUtilization;
    const current = ((curMetric?.current || {}) as AnyRecord).averageUtilization;
    const metricName = (specMetric?.name as string) || 'cpu';
    return target != null ? `${metricName}: ${current != null ? `${current}%` : '<unknown>'}/${target}%` : '<none>';
  },
};

/** Resolve one `{...}` token (path / transform / item-transform, + `?fallback`). */
function resolveToken(token: string, item: K8sItem): string {
  if (token.startsWith('|')) {
    const [name] = token.slice(1).split(':');
    const fn = ITEM_TRANSFORMS[name];
    return fn ? fn(item) : '';
  }

  // Peel off the optional `?fallback` default, then the optional `|transform`.
  const qIdx = token.indexOf('?');
  const def = qIdx >= 0 ? token.slice(qIdx + 1) : undefined;
  const head = qIdx >= 0 ? token.slice(0, qIdx) : token;

  let path = head;
  let result: unknown;
  const pIdx = head.indexOf('|');
  if (pIdx >= 0) {
    path = head.slice(0, pIdx);
    const t = head.slice(pIdx + 1);
    const ci = t.indexOf(':');
    const tname = ci >= 0 ? t.slice(0, ci) : t;
    const targs = ci >= 0 ? t.slice(ci + 1).split(',') : [];
    const fn = VALUE_TRANSFORMS[tname];
    result = fn ? fn(getPath(item, path), targs) : getPath(item, path);
  } else {
    result = getPath(item, path);
  }

  if (result === undefined || result === null || result === '') {
    result = def !== undefined ? def : '';
  }
  return String(result);
}

/** Expand a column's `value` template against one item. */
function interpolate(template: string, item: K8sItem): string {
  return template.replace(/\{([^}]*)\}/g, (_m, tok) => resolveToken(tok, item));
}

/**
 * Render a kubectl-style table from a declarative column spec. The header is
 * derived from each column's `name` (pad()-ed to `width`); the last column is
 * left unpadded, matching real kubectl's trailing AGE column.
 * @param spec - Column definitions (from kubelens.config.yaml `tables:`)
 * @param items - Resources to render as rows
 * @returns Multi-line string: header line followed by one line per item
 */
export function renderTable(spec: TableSpec, items: K8sItem[]): string {
  const cols = spec.columns;
  const last = cols.length - 1;
  const header = cols.map((c, i) => (i === last ? c.name : pad(c.name, c.width ?? 0))).join('');
  const rows = items.map(item =>
    cols.map((c, i) => {
      const v = interpolate(c.value, item);
      return i === last ? v : pad(v, c.width ?? 0);
    }).join('')
  );
  return [header, ...rows].join('\n');
}

// Thin wrappers kept for the kinds covered by snapshot-parsers.spec.ts — they
// now just look up the kind's spec and render it, exercising the data-driven
// path end to end. The dispatch in snapshot-commands.ts resolves specs by file,
// so a new kind needs no wrapper, only a `tables:` entry.
const EMPTY_SPEC: TableSpec = { columns: [{ name: 'NAME', value: '{.metadata.name}' }] };
const byKind = (kind: string, items: K8sItem[]) => renderTable(getTableSpec(kind) ?? EMPTY_SPEC, items);

export const generateDeploymentTable = (items: K8sItem[]) => byKind('Deployment', items);
export const generateServiceTable = (items: K8sItem[]) => byKind('Service', items);
export const generateCronjobTable = (items: K8sItem[]) => byKind('CronJob', items);
export const generateStatefulsetTable = (items: K8sItem[]) => byKind('StatefulSet', items);
export const generateJobTable = (items: K8sItem[]) => byKind('Job', items);
export const generateConfigmapTable = (items: K8sItem[]) => byKind('ConfigMap', items);
export const generateEndpointTable = (items: K8sItem[]) => byKind('Endpoints', items);

// --- Describe generators ---

/**
 * Generate `kubectl describe deployment` output.
 * @param item - A single Deployment K8sItem, or `null`
 * @returns Multi-line string mimicking real kubectl output:
 * ```
 * Name:                   web
 * Namespace:              demo
 * Replicas:               2 desired | 2 updated | 2 total | 2 ready | 0 unavailable
 * Pod Template:
 *   Containers:
 *     web:
 *       Image:      nginx:1.25
 * Conditions:
 *   ...
 * ```
 * Returns `'Error from server (NotFound): ...'` if item is null.
 */
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

/**
 * Generate `kubectl describe pod` output by parsing pods-snapshot.txt.
 * Unlike other describe functions, this reads from the text snapshot (not YAML).
 * @param podName - Pod name to look up in pods-snapshot.txt
 * @param namespace - K8s namespace (defaults to DEFAULT_NAMESPACE)
 * @returns Multi-line string:
 * ```
 * Name:             web-abc-123
 * Namespace:        demo
 * Status:           Running
 * Containers:
 *   main:
 *     Ready:          1/1
 * ```
 * Returns `'Error from server (NotFound): ...'` if pod not found.
 */
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

/**
 * Generate `kubectl describe service` output.
 * @param item - A single Service K8sItem, or `null`
 * @returns Multi-line string:
 * ```
 * Name:              api-server-svc
 * Namespace:         demo
 * Type:              ClusterIP
 * IP:                10.0.0.1
 *   Port:            http  80/TCP
 *   TargetPort:      8080/TCP
 * ```
 * Returns `'Error from server (NotFound): ...'` if item is null.
 */
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

/**
 * Generate a generic `kubectl describe` output for resources without a specialized formatter
 * (ConfigMap, Secret, ServiceAccount, PVC, etc.).
 * @param item - A single K8sItem, or `null`
 * @returns Multi-line string:
 * ```
 * Name:              app-config
 * Namespace:         demo
 * Kind:              ConfigMap
 * Labels:            app=web
 * Data:
 *   config.yaml
 * ```
 * Returns `'Error from server (NotFound): ...'` if item is null.
 */
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
