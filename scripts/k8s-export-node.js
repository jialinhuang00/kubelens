#!/usr/bin/env node
// k8s-export-node.js — K8s cluster exporter using @kubernetes/client-node
//
// Usage:
//   node scripts/k8s-export-node.js                     # all namespaces
//   node scripts/k8s-export-node.js -n my-namespace      # single namespace
//   node scripts/k8s-export-node.js --jobs 5             # parallel workers
//   node scripts/k8s-export-node.js --resume             # skip completed
'use strict';

const k8s  = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const fs   = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args     = process.argv.slice(2);
const nsFlag   = [];
let jobs       = 3;
let resume     = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if ((a === '-n' || a === '--namespace') && args[i + 1]) { nsFlag.push(args[++i]); }
  else if (a === '--jobs' && args[i + 1])                  { jobs = parseInt(args[++i], 10); }
  else if (a === '--resume')                               { resume = true; }
  else if (a === '-h' || a === '--help')                   { usage(); process.exit(0); }
}

function usage() {
  console.log('Usage: node scripts/k8s-export-node.js [-n ns] [--jobs N] [--resume]');
}

// ---------------------------------------------------------------------------
// Resource batch definitions — mirrors Go nsBatches exactly
// Each inner array = one Promise.all batch, fetched concurrently.
// ---------------------------------------------------------------------------

const NS_BATCHES = [
  ['deployments', 'statefulsets', 'daemonsets', 'cronjobs', 'jobs'],
  ['services', 'ingresses', 'endpoints'],
  ['configmaps', 'secrets', 'serviceaccounts'],
  ['persistentvolumeclaims', 'roles', 'rolebindings'],
  ['networkpolicies', 'horizontalpodautoscalers', 'poddisruptionbudgets'],
];

// CRDs fetched via CustomObjectsApi — { group, version, plural, kind }
const CRD_BATCHES = [
  [
    { group: 'gateway.networking.k8s.io', version: 'v1',       plural: 'gateways',   kind: 'Gateway'   },
    { group: 'gateway.networking.k8s.io', version: 'v1',       plural: 'httproutes', kind: 'HTTPRoute'  },
    { group: 'gateway.networking.k8s.io', version: 'v1alpha2', plural: 'tcproutes',  kind: 'TCPRoute'   },
    { group: 'argoproj.io',               version: 'v1alpha1', plural: 'applications', kind: 'Application' },
  ],
];

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

// Maps plural resource name → { kind, apiVersion } for injecting into typed API items.
// Kubernetes list responses don't set kind/apiVersion on individual items.
const RESOURCE_META = {
  deployments:              { kind: 'Deployment',             apiVersion: 'apps/v1' },
  statefulsets:             { kind: 'StatefulSet',            apiVersion: 'apps/v1' },
  daemonsets:               { kind: 'DaemonSet',              apiVersion: 'apps/v1' },
  replicasets:              { kind: 'ReplicaSet',             apiVersion: 'apps/v1' },
  jobs:                     { kind: 'Job',                    apiVersion: 'batch/v1' },
  cronjobs:                 { kind: 'CronJob',                apiVersion: 'batch/v1' },
  services:                 { kind: 'Service',                apiVersion: 'v1' },
  endpoints:                { kind: 'Endpoints',              apiVersion: 'v1' },
  configmaps:               { kind: 'ConfigMap',              apiVersion: 'v1' },
  secrets:                  { kind: 'Secret',                 apiVersion: 'v1' },
  serviceaccounts:          { kind: 'ServiceAccount',         apiVersion: 'v1' },
  persistentvolumeclaims:   { kind: 'PersistentVolumeClaim',  apiVersion: 'v1' },
  pods:                     { kind: 'Pod',                    apiVersion: 'v1' },
  ingresses:                { kind: 'Ingress',                apiVersion: 'networking.k8s.io/v1' },
  networkpolicies:          { kind: 'NetworkPolicy',          apiVersion: 'networking.k8s.io/v1' },
  roles:                    { kind: 'Role',                   apiVersion: 'rbac.authorization.k8s.io/v1' },
  rolebindings:             { kind: 'RoleBinding',            apiVersion: 'rbac.authorization.k8s.io/v1' },
  horizontalpodautoscalers: { kind: 'HorizontalPodAutoscaler', apiVersion: 'autoscaling/v2' },
  poddisruptionbudgets:     { kind: 'PodDisruptionBudget',    apiVersion: 'policy/v1' },
};

// Typed resource fetchers keyed by plural name.
// Each returns raw items array (no .body wrapper — we unwrap here).
function makeFetchers(clients) {
  const { core, apps, batch, net, rbac, autoscaling, policy } = clients;

  return {
    deployments:              ns => apps.listNamespacedDeployment({ namespace: ns }),
    statefulsets:             ns => apps.listNamespacedStatefulSet({ namespace: ns }),
    daemonsets:               ns => apps.listNamespacedDaemonSet({ namespace: ns }),
    replicasets:              ns => apps.listNamespacedReplicaSet({ namespace: ns }),
    jobs:                     ns => batch.listNamespacedJob({ namespace: ns }),
    cronjobs:                 ns => batch.listNamespacedCronJob({ namespace: ns }),
    services:                 ns => core.listNamespacedService({ namespace: ns }),
    endpoints:                ns => core.listNamespacedEndpoints({ namespace: ns }),
    configmaps:               ns => core.listNamespacedConfigMap({ namespace: ns }),
    secrets:                  ns => core.listNamespacedSecret({ namespace: ns }),
    serviceaccounts:          ns => core.listNamespacedServiceAccount({ namespace: ns }),
    persistentvolumeclaims:   ns => core.listNamespacedPersistentVolumeClaim({ namespace: ns }),
    pods:                     ns => core.listNamespacedPod({ namespace: ns }),
    ingresses:                ns => net.listNamespacedIngress({ namespace: ns }),
    networkpolicies:          ns => net.listNamespacedNetworkPolicy({ namespace: ns }),
    roles:                    ns => rbac.listNamespacedRole({ namespace: ns }),
    rolebindings:             ns => rbac.listNamespacedRoleBinding({ namespace: ns }),
    horizontalpodautoscalers: ns => autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace: ns }),
    poddisruptionbudgets:     ns => policy.listNamespacedPodDisruptionBudget({ namespace: ns }),
  };
}

async function fetchOne(fetchers, ns, resourceType) {
  const fn = fetchers[resourceType];
  if (!fn) return [];
  try {
    const res = await fn(ns);
    const items = res.items ?? [];
    // Typed API items don't carry kind/apiVersion — inject from our map.
    const meta = RESOURCE_META[resourceType];
    if (!meta) return items;
    return items.map(item => ({ ...item, kind: meta.kind, apiVersion: meta.apiVersion }));
  } catch (e) {
    const code = e?.response?.statusCode ?? e?.statusCode;
    if (code === 404 || code === 405) return []; // resource not on this cluster
    throw e;
  }
}

async function fetchCRD(customObjs, ns, { group, version, plural, kind }) {
  try {
    const res = await customObjs.listNamespacedCustomObject({ group, version, namespace: ns, plural });
    const items = res.items ?? [];
    // CustomObjectsApi doesn't inject kind/apiVersion into each item
    return items.map(item => ({
      ...item,
      kind,
      apiVersion: `${group}/${version}`,
    }));
  } catch (e) {
    const code = e?.response?.statusCode ?? e?.statusCode;
    if (code === 404 || code === 405) return [];
    throw e;
  }
}

// ---------------------------------------------------------------------------
// YAML / file helpers
// ---------------------------------------------------------------------------

function stripManagedFields(item) {
  const obj = JSON.parse(JSON.stringify(item));
  if (obj.metadata) delete obj.metadata.managedFields;
  return obj;
}

function marshalList(items) {
  const stripped = items.map(stripManagedFields);
  return yaml.dump({ apiVersion: 'v1', kind: 'List', items: stripped }, { noRefs: true });
}

async function atomicWrite(fpath, data) {
  const tmp = fpath + '.tmp';
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, fpath);
}

async function touchFile(fpath) {
  const now = new Date();
  try {
    await fs.utimes(fpath, now, now);
  } catch {
    await fs.writeFile(fpath, '');
  }
}

// Group items by kind, write one YAML file per kind.
async function writeBatchResults(nsDir, items, doResume) {
  const byKind = {};
  for (const item of items) {
    const kind = item.kind ?? item.Kind;
    if (!kind) continue;
    (byKind[kind] = byKind[kind] ?? []).push(item);
  }
  for (const [kind, kindItems] of Object.entries(byKind)) {
    const fname = kindToFilename(kind);
    const fpath = path.join(nsDir, fname + '.yaml');
    if (doResume) {
      try { await fs.access(fpath); continue; } catch {}
    }
    await atomicWrite(fpath, marshalList(kindItems));
  }
}

// Kind → filename (lowercase plural, strip group suffix).
// Mirrors kindmap.go / kind-map.json logic.
const KIND_MAP = {
  Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets',
  ReplicaSet: 'replicasets', Job: 'jobs', CronJob: 'cronjobs',
  Service: 'services', Endpoints: 'endpoints', Ingress: 'ingresses',
  ConfigMap: 'configmaps', Secret: 'secrets', ServiceAccount: 'serviceaccounts',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  Role: 'roles', RoleBinding: 'rolebindings',
  NetworkPolicy: 'networkpolicies',
  HorizontalPodAutoscaler: 'horizontalpodautoscalers',
  PodDisruptionBudget: 'poddisruptionbudgets',
  Pod: 'pods',
  Gateway: 'gateways', HTTPRoute: 'httproutes', TCPRoute: 'tcproutes',
  Application: 'applications',
};

function kindToFilename(kind) {
  return KIND_MAP[kind] ?? kind.toLowerCase() + 's';
}

// ---------------------------------------------------------------------------
// Pod text formatters (mirrors Go fetcher.go)
// ---------------------------------------------------------------------------

function formatAge(ts) {
  if (!ts) return '<unknown>';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60)         return d + 's';
  if (d < 3600)       return Math.floor(d / 60) + 'm';
  if (d < 86400)      return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}

function podStatus(pod) {
  if (pod.metadata?.deletionTimestamp) return 'Terminating';
  for (const cs of pod.status?.initContainerStatuses ?? []) {
    if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
  }
  for (const cs of pod.status?.containerStatuses ?? []) {
    if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
    if (cs.state?.terminated?.exitCode !== 0 && cs.state?.terminated) {
      return cs.state.terminated.reason || 'Error';
    }
  }
  return pod.status?.phase ?? 'Unknown';
}

function podRestarts(pod) {
  return (pod.status?.containerStatuses ?? []).reduce((n, cs) => n + (cs.restartCount ?? 0), 0);
}

function podReady(pod) {
  const total = (pod.spec?.containers ?? []).length;
  const ready = (pod.status?.containerStatuses ?? []).filter(cs => cs.ready).length;
  return `${ready}/${total}`;
}

function formatPodsWide(pods) {
  const cols = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', 'IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'];
  const rows = pods.map(p => [
    p.metadata.name,
    podReady(p),
    podStatus(p),
    String(podRestarts(p)),
    formatAge(p.metadata.creationTimestamp),
    p.status?.podIP ?? '<none>',
    p.spec?.nodeName ?? '<none>',
    '<none>',
    '<none>',
  ]);
  return formatTable([cols, ...rows]);
}

function formatPodsImages(pods) {
  const cols = ['POD', 'IMAGE'];
  const rows = pods.map(p => [
    p.metadata.name,
    (p.spec?.containers ?? []).map(c => c.image).join(','),
  ]);
  return formatTable([cols, ...rows]);
}

function formatTable(rows) {
  const widths = rows[0].map((_, ci) => Math.max(...rows.map(r => (r[ci] ?? '').length)));
  return rows.map(r => r.map((cell, ci) => cell.padEnd(widths[ci])).join('   ')).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Namespace export
// ---------------------------------------------------------------------------

async function exportOneNamespace(clients, ns, baseDir, doResume) {
  const start = Date.now();
  console.log(`=== Namespace: ${ns} ===`);

  const nsDir = path.join(baseDir, ns);
  await fs.mkdir(nsDir, { recursive: true });

  const fetchers = makeFetchers(clients);

  // 6 standard batches + CRD batches, all concurrent
  const batchPromises = NS_BATCHES.map(async batch => {
    const label = batch.join(',');
    console.log(`  → fetching ${label}`);
    const results = await Promise.all(batch.map(rt => fetchOne(fetchers, ns, rt)));
    const items = results.flat();
    await writeBatchResults(nsDir, items, doResume);
    console.log(`  ← ${label} done`);
  });

  const crdPromises = CRD_BATCHES.map(async batch => {
    const label = batch.map(b => b.plural).join(',');
    console.log(`  → fetching ${label}`);
    const results = await Promise.all(batch.map(crd => fetchCRD(clients.customObjs, ns, crd)));
    const items = results.flat();
    await writeBatchResults(nsDir, items, doResume);
    console.log(`  ← ${label} done`);
  });

  // Pods: fetch once, write 3 outputs
  const podsPromise = (async () => {
    console.log('  → fetching pods');
    const pods = await fetchOne(fetchers, ns, 'pods');
    await writeBatchResults(nsDir, pods, doResume);
    console.log('  ← pods done');

    const snapPath = path.join(nsDir, 'pods-snapshot.txt');
    const imgPath  = path.join(nsDir, 'pods-images.txt');

    if (!(doResume && await fileExists(snapPath))) {
      await atomicWrite(snapPath, formatPodsWide(pods));
    }
    if (!(doResume && await fileExists(imgPath))) {
      await atomicWrite(imgPath, formatPodsImages(pods));
    }
    console.log(`  ← pods done (${pods.length} pods)`);
  })();

  await Promise.all([...batchPromises, ...crdPromises, podsPromise]);

  await touchFile(path.join(nsDir, '.done'));
  console.log(`✓ Namespace ${ns} completed in ${Math.round((Date.now() - start) / 1000)}s\n`);
}

async function fileExists(fpath) {
  try { await fs.access(fpath); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

async function runWithConcurrency(items, limit, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      await fn(queue.shift());
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const baseDir = process.env.K8S_SNAPSHOT_DIR ?? 'k8s-snapshot';

  // Load kubeconfig
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const clients = {
    core:        kc.makeApiClient(k8s.CoreV1Api),
    apps:        kc.makeApiClient(k8s.AppsV1Api),
    batch:       kc.makeApiClient(k8s.BatchV1Api),
    net:         kc.makeApiClient(k8s.NetworkingV1Api),
    rbac:        kc.makeApiClient(k8s.RbacAuthorizationV1Api),
    autoscaling: kc.makeApiClient(k8s.AutoscalingV2Api),
    policy:      kc.makeApiClient(k8s.PolicyV1Api),
    customObjs:  kc.makeApiClient(k8s.CustomObjectsApi),
  };

  // Discover namespaces
  let namespaces = [...nsFlag];
  if (namespaces.length === 0) {
    console.log('Checking cluster connection...');
    const res = await clients.core.listNamespace();
    namespaces = res.items.map(ns => ns.metadata.name);
    console.log(`Discovered ${namespaces.length} namespaces`);
  }

  // Current context
  const ctxName = kc.getCurrentContext() ?? '';
  console.log(`Cluster context: ${ctxName}`);
  console.log(`Export target:   ${baseDir}`);
  console.log(`Namespaces:      ${namespaces.join(' ')}`);
  console.log(`Parallel jobs:   ${jobs}`);
  console.log();

  const start = Date.now();

  if (resume) {
    await fs.rm(path.join(baseDir, '.export-complete'), { force: true });
    // remove stale .tmp files
    try {
      const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
      await Promise.all(
        entries
          .filter(e => !e.isDirectory() && e.name.endsWith('.tmp'))
          .map(e => fs.rm(path.join(e.parentPath ?? e.path, e.name), { force: true }))
      );
    } catch {}

    const total = namespaces.length;
    const remaining = [];
    for (const ns of namespaces) {
      if (await fileExists(path.join(baseDir, ns, '.done'))) {
        console.log(`=== Namespace: ${ns} === (complete, skipping)`);
      } else {
        remaining.push(ns);
      }
    }
    namespaces = remaining;
    console.log(`Resuming: ${namespaces.length} remaining out of ${total} namespaces\n`);
  } else {
    await fs.rm(baseDir, { recursive: true, force: true });
  }

  await runWithConcurrency(namespaces, jobs, ns =>
    exportOneNamespace(clients, ns, baseDir, resume)
  );

  await touchFile(path.join(baseDir, '.export-complete'));

  // Summary
  const elapsed = Math.round((Date.now() - start) / 1000);
  let fileCount = 0;
  let totalBytes = 0;
  try {
    const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('.tmp')) {
        fileCount++;
        try {
          const stat = await fs.stat(path.join(e.parentPath ?? e.path, e.name));
          totalBytes += stat.size;
        } catch {}
      }
    }
  } catch {}

  function humanSize(b) {
    if (b < 1024)           return b + 'B';
    if (b < 1024 * 1024)    return (b / 1024).toFixed(1) + 'K';
    if (b < 1024 ** 3)      return (b / 1024 / 1024).toFixed(1) + 'M';
    return (b / 1024 ** 3).toFixed(1) + 'G';
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Export Complete                                         ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Files: ${fileCount} files`);
  console.log(`║  Size:  ${humanSize(totalBytes)}`);
  console.log(`║  Time:  ${elapsed}s`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(e => {
  console.error('ERROR:', e.message ?? e);
  process.exit(1);
});
