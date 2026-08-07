#!/usr/bin/env node
/**
 * Builds test-fixtures/table-items.json: one representative item per Kind that
 * kubelens.config.yaml declares a table for.
 *
 * Both backends render these same items and the two outputs are compared
 * (api/utils/table-parity.itest.ts). The items are shared input, not expected
 * output — nobody writes down what the table should look like, so neither
 * implementation can be graded against a belief instead of against the other.
 *
 * Real cluster objects where the cluster has them, synthetic ones for the rest,
 * with fields chosen to reach every transform the config uses: jobDuration,
 * hpaTargets, accessModes, the ingress trio, ports with a nodePort, ref, bool, kv.
 *
 * Timestamps are days old on purpose. `age` is computed at render time on both
 * sides, so a value near an hour or minute boundary could tick over between the
 * two calls; days-old values only change once a day.
 *
 * Usage: node scripts/capture-table-fixtures.js [outfile]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'test-fixtures', 'table-items.json');

// Kind → the plural kubectl asks for. Only used to pull a real object; a Kind
// missing here or absent from the cluster falls back to SYNTHETIC.
const PLURAL = {
  Deployment: 'deployments', ReplicaSet: 'replicasets', Service: 'services',
  CronJob: 'cronjobs', StatefulSet: 'statefulsets', Job: 'jobs',
  ConfigMap: 'configmaps', Endpoints: 'endpoints', Secret: 'secrets',
  PersistentVolumeClaim: 'pvc', ServiceAccount: 'serviceaccounts',
  DaemonSet: 'daemonsets', Ingress: 'ingresses',
  HorizontalPodAutoscaler: 'hpa', Role: 'roles', RoleBinding: 'rolebindings',
  NetworkPolicy: 'networkpolicies',
};

const OLD = '2026-01-02T03:04:05Z';
const meta = (name) => ({ name, namespace: 'demo', creationTimestamp: OLD });

// Chosen to exercise the transforms, not to look realistic.
const SYNTHETIC = {
  CronJob: { metadata: meta('nightly'), spec: { schedule: '0 3 * * *', suspend: false }, status: { active: [{}, {}], lastScheduleTime: OLD } },
  StatefulSet: { metadata: meta('db'), spec: { replicas: 3 }, status: { readyReplicas: 2 } },
  Job: {
    metadata: meta('migrate'), spec: { completions: 1 },
    status: { succeeded: 1, startTime: '2026-01-02T03:04:05Z', completionTime: '2026-01-02T04:10:35Z' },
  },
  PersistentVolumeClaim: {
    metadata: meta('data'),
    spec: { accessModes: ['ReadWriteOnce', 'ReadWriteMany'], storageClassName: 'gp3', volumeName: 'pv-1' },
    status: { phase: 'Bound', capacity: { storage: '20Gi' } },
  },
  Ingress: {
    metadata: meta('web'),
    spec: { ingressClassName: 'nginx', tls: [{ hosts: ['a.example'] }], rules: [{ host: 'a.example' }, { host: 'b.example' }] },
    status: { loadBalancer: { ingress: [{ hostname: 'lb.example' }, { ip: '10.0.0.7' }] } },
  },
  HorizontalPodAutoscaler: {
    metadata: meta('api'),
    spec: {
      minReplicas: 2, maxReplicas: 10,
      scaleTargetRef: { kind: 'Deployment', name: 'api' },
      metrics: [{ resource: { name: 'cpu', target: { averageUtilization: 80 } } }],
    },
    status: { currentReplicas: 3, currentMetrics: [{ resource: { current: { averageUtilization: 41 } } }] },
  },
  NetworkPolicy: {
    metadata: meta('deny-all'),
    spec: { podSelector: { matchLabels: { app: 'web', tier: 'front' } }, policyTypes: ['Ingress', 'Egress'] },
  },
  // A service with a nodePort, which the real cluster's ClusterIP services lack.
  Service: {
    metadata: meta('gateway'),
    spec: { type: 'NodePort', clusterIP: '10.96.0.9', externalIPs: ['1.2.3.4'], ports: [{ port: 80, nodePort: 30080, protocol: 'TCP' }, { port: 443, protocol: 'TCP' }] },
  },
};

function fromCluster(kind) {
  const plural = PLURAL[kind];
  if (!plural) return null;
  try {
    const out = execFileSync('kubectl', ['get', plural, '-A', '-o', 'json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000,
    });
    const items = JSON.parse(out).items || [];
    return items[0] ?? null;
  } catch {
    return null;
  }
}

const config = yaml.load(fs.readFileSync(path.join(ROOT, 'kubelens.config.yaml'), 'utf8'));
const kinds = Object.keys(config.tables || {});
if (!kinds.length) {
  console.error('kubelens.config.yaml declares no tables — nothing to capture');
  process.exit(2);
}

const items = {};
const source = {};
for (const kind of kinds) {
  // Synthetic wins where it exists: it was written to reach a transform the
  // cluster's own object does not have.
  const synthetic = SYNTHETIC[kind];
  const real = synthetic ? null : fromCluster(kind);
  const item = synthetic ?? real;
  if (!item) {
    console.error(`no item for ${kind} — add one to SYNTHETIC in this script`);
    process.exit(1);
  }
  items[kind] = item;
  source[kind] = synthetic ? 'synthetic' : 'cluster';
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(items, null, 2) + '\n');
for (const kind of kinds) console.log(`  ${kind.padEnd(24)} ${source[kind]}`);
console.log(`${kinds.length} kinds → ${path.relative(ROOT, OUT)}`);
