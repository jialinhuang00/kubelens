#!/usr/bin/env node
// k8s-export-node-workers.js — worker_threads version of k8s-export-node.js
//
// Each worker thread creates its own K8s API clients and exports an assigned
// slice of namespaces concurrently. Breaks the single-threaded event loop
// limit — CPU work (YAML serialisation, file writes) runs on multiple OS threads.
//
// Usage:
//   node scripts/k8s-export-node-workers.js                     # all namespaces
//   node scripts/k8s-export-node-workers.js --workers 8         # N worker threads
//   node scripts/k8s-export-node-workers.js -n my-namespace      # single namespace
//   node scripts/k8s-export-node-workers.js --resume             # skip completed
'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');

// ============================================================================
// SHARED CODE — used by both main thread and worker threads
// ============================================================================

const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const fs = require('fs').promises;

const NS_BATCHES = [
  ['deployments', 'statefulsets', 'daemonsets', 'cronjobs', 'jobs'],
  ['services', 'ingresses', 'endpoints'],
  ['configmaps', 'secrets', 'serviceaccounts'],
  ['persistentvolumeclaims', 'roles', 'rolebindings'],
  ['networkpolicies', 'horizontalpodautoscalers', 'poddisruptionbudgets'],
];

const CRD_BATCHES = [
  [
    { group: 'gateway.networking.k8s.io', version: 'v1', plural: 'gateways', kind: 'Gateway' },
    { group: 'gateway.networking.k8s.io', version: 'v1', plural: 'httproutes', kind: 'HTTPRoute' },
    { group: 'gateway.networking.k8s.io', version: 'v1alpha2', plural: 'tcproutes', kind: 'TCPRoute' },
    { group: 'argoproj.io', version: 'v1alpha1', plural: 'applications', kind: 'Application' },
  ],
];

const RESOURCE_META = {
  deployments: { kind: 'Deployment', apiVersion: 'apps/v1' },
  statefulsets: { kind: 'StatefulSet', apiVersion: 'apps/v1' },
  daemonsets: { kind: 'DaemonSet', apiVersion: 'apps/v1' },
  replicasets: { kind: 'ReplicaSet', apiVersion: 'apps/v1' },
  jobs: { kind: 'Job', apiVersion: 'batch/v1' },
  cronjobs: { kind: 'CronJob', apiVersion: 'batch/v1' },
  services: { kind: 'Service', apiVersion: 'v1' },
  endpoints: { kind: 'Endpoints', apiVersion: 'v1' },
  configmaps: { kind: 'ConfigMap', apiVersion: 'v1' },
  secrets: { kind: 'Secret', apiVersion: 'v1' },
  serviceaccounts: { kind: 'ServiceAccount', apiVersion: 'v1' },
  persistentvolumeclaims: { kind: 'PersistentVolumeClaim', apiVersion: 'v1' },
  pods: { kind: 'Pod', apiVersion: 'v1' },
  ingresses: { kind: 'Ingress', apiVersion: 'networking.k8s.io/v1' },
  networkpolicies: { kind: 'NetworkPolicy', apiVersion: 'networking.k8s.io/v1' },
  roles: { kind: 'Role', apiVersion: 'rbac.authorization.k8s.io/v1' },
  rolebindings: { kind: 'RoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1' },
  horizontalpodautoscalers: { kind: 'HorizontalPodAutoscaler', apiVersion: 'autoscaling/v2' },
  poddisruptionbudgets: { kind: 'PodDisruptionBudget', apiVersion: 'policy/v1' },
};

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

function makeFetchers(clients) {
  const { core, apps, batch, net, rbac, autoscaling, policy } = clients;
  return {
    deployments: (ns, opts) => apps.listNamespacedDeployment({ namespace: ns }, opts),
    statefulsets: (ns, opts) => apps.listNamespacedStatefulSet({ namespace: ns }, opts),
    daemonsets: (ns, opts) => apps.listNamespacedDaemonSet({ namespace: ns }, opts),
    replicasets: (ns, opts) => apps.listNamespacedReplicaSet({ namespace: ns }, opts),
    jobs: (ns, opts) => batch.listNamespacedJob({ namespace: ns }, opts),
    cronjobs: (ns, opts) => batch.listNamespacedCronJob({ namespace: ns }, opts),
    services: (ns, opts) => core.listNamespacedService({ namespace: ns }, opts),
    endpoints: (ns, opts) => core.listNamespacedEndpoints({ namespace: ns }, opts),
    configmaps: (ns, opts) => core.listNamespacedConfigMap({ namespace: ns }, opts),
    secrets: (ns, opts) => core.listNamespacedSecret({ namespace: ns }, opts),
    serviceaccounts: (ns, opts) => core.listNamespacedServiceAccount({ namespace: ns }, opts),
    persistentvolumeclaims: (ns, opts) => core.listNamespacedPersistentVolumeClaim({ namespace: ns }, opts),
    pods: (ns, opts) => core.listNamespacedPod({ namespace: ns }, opts),
    ingresses: (ns, opts) => net.listNamespacedIngress({ namespace: ns }, opts),
    networkpolicies: (ns, opts) => net.listNamespacedNetworkPolicy({ namespace: ns }, opts),
    roles: (ns, opts) => rbac.listNamespacedRole({ namespace: ns }, opts),
    rolebindings: (ns, opts) => rbac.listNamespacedRoleBinding({ namespace: ns }, opts),
    horizontalpodautoscalers: (ns, opts) => autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace: ns }, opts),
    poddisruptionbudgets: (ns, opts) => policy.listNamespacedPodDisruptionBudget({ namespace: ns }, opts),
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

// Build per-request options with AbortController — actually cancels the TCP connection on timeout
function makeRequestOpts() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const opts = {
    // pre must return an object with .toPromise() — rxjsStub's mergeMap calls .toPromise() on it.
    // async function returns a native Promise which has no .toPromise() → TypeError.
    // Duck-type the rxjsStub Observable interface instead.
    middleware: [{
      pre(ctx) { ctx.setSignal(controller.signal); return { toPromise: () => Promise.resolve(ctx) }; },
      post(ctx) { return { toPromise: () => Promise.resolve(ctx) }; },
    }],
    middlewareMergeStrategy: 'prepend',
  };
  return { controller, timer, opts };
}

async function fetchOne(fetchers, ns, resourceType) {
  const fn = fetchers[resourceType];
  if (!fn) return [];
  const { controller, timer, opts } = makeRequestOpts();
  try {
    const res = await fn(ns, opts);
    const items = res.items ?? [];
    const meta = RESOURCE_META[resourceType];
    if (!meta) return items;
    return items.map(item => ({ ...item, kind: meta.kind, apiVersion: meta.apiVersion }));
  } catch (e) {
    const code = e?.response?.statusCode ?? e?.statusCode;
    if (code === 404 || code === 405) return [];
    if (controller.signal.aborted) {
      console.warn(`  ! timeout (${REQUEST_TIMEOUT_MS / 1000}s): ${resourceType} in ${ns} — skipped`);
      return [];
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCRD(customObjs, ns, { group, version, plural, kind }) {
  const { controller, timer, opts } = makeRequestOpts();
  try {
    const res = await customObjs.listNamespacedCustomObject({ group, version, namespace: ns, plural }, opts);
    return (res.items ?? []).map(item => ({ ...item, kind, apiVersion: `${group}/${version}` }));
  } catch (e) {
    const code = e?.response?.statusCode ?? e?.statusCode;
    if (code === 404 || code === 405) return [];
    if (controller.signal.aborted) {
      console.warn(`  ! timeout (${REQUEST_TIMEOUT_MS / 1000}s): ${plural} in ${ns} — skipped`);
      return [];
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function stripManagedFields(item) {
  const obj = JSON.parse(JSON.stringify(item));
  if (obj.metadata) delete obj.metadata.managedFields;
  return obj;
}

function marshalList(items) {
  return yaml.dump({ apiVersion: 'v1', kind: 'List', items: items.map(stripManagedFields) }, { noRefs: true });
}

async function atomicWrite(fpath, data) {
  const tmp = fpath + '.tmp';
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, fpath);
}

async function touchFile(fpath) {
  const now = new Date();
  try { await fs.utimes(fpath, now, now); } catch { await fs.writeFile(fpath, ''); }
}

async function fileExists(fpath) {
  try { await fs.access(fpath); return true; } catch { return false; }
}

async function writeBatchResults(nsDir, items, doResume) {
  const byKind = {};
  for (const item of items) {
    const kind = item.kind ?? item.Kind;
    if (!kind) continue;
    (byKind[kind] = byKind[kind] ?? []).push(item);
  }
  for (const [kind, kindItems] of Object.entries(byKind)) {
    const fpath = path.join(nsDir, kindToFilename(kind) + '.yaml');
    if (doResume) {
      try { await fs.access(fpath); continue; } catch { }
    }
    await atomicWrite(fpath, marshalList(kindItems));
  }
}

// Pod text formatters
function formatAge(ts) {
  if (!ts) return '<unknown>';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
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

function podReady(pod) {
  const total = (pod.spec?.containers ?? []).length;
  const ready = (pod.status?.containerStatuses ?? []).filter(cs => cs.ready).length;
  return `${ready}/${total}`;
}

function formatTable(rows) {
  const widths = rows[0].map((_, ci) => Math.max(...rows.map(r => (r[ci] ?? '').length)));
  return rows.map(r => r.map((cell, ci) => cell.padEnd(widths[ci])).join('   ')).join('\n') + '\n';
}

function formatPodsWide(pods) {
  const cols = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', 'IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'];
  const rows = pods.map(p => [
    p.metadata.name,
    podReady(p),
    podStatus(p),
    String((p.status?.containerStatuses ?? []).reduce((n, cs) => n + (cs.restartCount ?? 0), 0)),
    formatAge(p.metadata.creationTimestamp),
    p.status?.podIP ?? '<none>',
    p.spec?.nodeName ?? '<none>',
    '<none>', '<none>',
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

async function exportOneNamespace(clients, ns, baseDir, doResume) {
  const start = Date.now();
  console.log(`=== Namespace: ${ns} ===`);

  const nsDir = path.join(baseDir, ns);
  await fs.mkdir(nsDir, { recursive: true });

  const fetchers = makeFetchers(clients);

  const batchPromises = NS_BATCHES.map(async batch => {
    const label = batch.join(',');
    console.log(`  → fetching ${label}`);
    const results = await Promise.all(batch.map(rt => fetchOne(fetchers, ns, rt)));
    await writeBatchResults(nsDir, results.flat(), doResume);
    console.log(`  ← ${label} done`);
  });

  const crdPromises = CRD_BATCHES.map(async batch => {
    const label = batch.map(b => b.plural).join(',');
    console.log(`  → fetching ${label}`);
    const results = await Promise.all(batch.map(crd => fetchCRD(clients.customObjs, ns, crd)));
    await writeBatchResults(nsDir, results.flat(), doResume);
    console.log(`  ← ${label} done`);
  });

  const podsPromise = (async () => {
    console.log('  → fetching pods');
    const pods = await fetchOne(fetchers, ns, 'pods');
    await writeBatchResults(nsDir, pods, doResume);
    console.log('  ← pods done');

    const snapPath = path.join(nsDir, 'pods-snapshot.txt');
    const imgPath = path.join(nsDir, 'pods-images.txt');
    if (!(doResume && await fileExists(snapPath))) await atomicWrite(snapPath, formatPodsWide(pods));
    if (!(doResume && await fileExists(imgPath))) await atomicWrite(imgPath, formatPodsImages(pods));
  })();

  await Promise.all([...batchPromises, ...crdPromises, podsPromise]);

  await touchFile(path.join(nsDir, '.done'));
  console.log(`✓ Namespace ${ns} completed in ${Math.round((Date.now() - start) / 1000)}s\n`);
}

// ============================================================================
// WORKER THREAD — runs when spawned by main thread
// ============================================================================

if (!isMainThread) {
  const { namespaces, baseDir, resume: doResume } = workerData;

  (async () => {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const clients = {
      core: kc.makeApiClient(k8s.CoreV1Api),
      apps: kc.makeApiClient(k8s.AppsV1Api),
      batch: kc.makeApiClient(k8s.BatchV1Api),
      net: kc.makeApiClient(k8s.NetworkingV1Api),
      rbac: kc.makeApiClient(k8s.RbacAuthorizationV1Api),
      autoscaling: kc.makeApiClient(k8s.AutoscalingV2Api),
      policy: kc.makeApiClient(k8s.PolicyV1Api),
      customObjs: kc.makeApiClient(k8s.CustomObjectsApi),
    };

    // Export assigned namespaces sequentially — parallelism comes from multiple workers
    for (const ns of namespaces) {
      await exportOneNamespace(clients, ns, baseDir, doResume);
    }
    parentPort.postMessage({ done: true, count: namespaces.length });
  })().catch(e => {
    console.error(`[worker] ERROR: ${e.message}`);
    parentPort.postMessage({ done: true, error: e.message });
  });

  // Stop here — don't fall through to main thread code
  return;
}

// ============================================================================
// MAIN THREAD
// ============================================================================

const args = process.argv.slice(2);
const nsFlag = [];
let workers = 4;  // default: 2 workers — prevents too many concurrent K8s connections
let resume = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if ((a === '-n' || a === '--namespace') && args[i + 1]) { nsFlag.push(args[++i]); }
  else if (a === '--workers' && args[i + 1]) { workers = parseInt(args[++i], 10); }
  else if (a === '--resume') { resume = true; }
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node scripts/k8s-export-node-workers.js [-n ns] [--workers N] [--resume]');
    process.exit(0);
  }
}

async function main() {
  const baseDir = process.env.K8S_SNAPSHOT_DIR ?? 'k8s-snapshot';

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api);

  // Discover namespaces
  let namespaces = [...nsFlag];
  if (namespaces.length === 0) {
    console.log('Checking cluster connection...');
    const res = await core.listNamespace();
    namespaces = res.items.map(ns => ns.metadata.name);
    console.log(`Discovered ${namespaces.length} namespaces`);
  }

  const ctxName = kc.getCurrentContext() ?? '';
  const actualWorkers = Math.min(workers, namespaces.length);
  console.log(`Cluster context: ${ctxName}`);
  console.log(`Export target:   ${baseDir}`);
  console.log(`Namespaces:      ${namespaces.join(' ')}`);
  console.log(`Worker threads:  ${actualWorkers}`);
  console.log();

  const start = Date.now();

  if (resume) {
    await fs.rm(path.join(baseDir, '.export-complete'), { force: true });
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

  // Split namespaces into chunks — one chunk per worker
  const chunks = Array.from({ length: actualWorkers }, (_, i) =>
    namespaces.filter((_, j) => j % actualWorkers === i)
  ).filter(c => c.length > 0);

  // Spawn workers and wait for all to finish
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, {
      workerData: { namespaces: chunk, baseDir, resume },
    });
    w.on('message', msg => { if (msg.done) resolve(); });
    w.on('error', reject);
    w.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  })));

  await touchFile(path.join(baseDir, '.export-complete'));

  // Summary
  const elapsed = Math.round((Date.now() - start) / 1000);
  let fileCount = 0, totalBytes = 0;
  try {
    const entries = await fs.readdir(baseDir, { recursive: true, withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('.tmp')) {
        fileCount++;
        try {
          const stat = await fs.stat(path.join(e.parentPath ?? e.path, e.name));
          totalBytes += stat.size;
        } catch { }
      }
    }
  } catch { }

  function humanSize(b) {
    if (b < 1024) return b + 'B';
    if (b < 1024 ** 2) return (b / 1024).toFixed(1) + 'K';
    if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(1) + 'M';
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
