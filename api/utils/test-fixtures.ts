/**
 * Shared test fixtures for utils/ unit tests.
 */

import type { K8sItem, K8sList, K8sMetadata } from './snapshot-loader';

export function makeMetadata(overrides: Partial<K8sMetadata> = {}): K8sMetadata {
  return {
    name: 'test-item',
    namespace: 'default',
    creationTimestamp: '2026-01-01T00:00:00Z',
    labels: {},
    annotations: {},
    ...overrides,
  };
}

export function makeItem(overrides: Partial<K8sItem> = {}): K8sItem {
  const { metadata, ...rest } = overrides;
  return {
    ...rest,
    metadata: { ...makeMetadata(), ...metadata } as K8sMetadata,
  };
}

export function makeList(items: K8sItem[]): K8sList {
  return { apiVersion: 'v1', kind: 'List', items };
}

export function makeDeploymentItem(name: string, opts: {
  replicas?: number;
  ready?: number;
  updated?: number;
  available?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  image?: string;
  podLabels?: Record<string, string>;
} = {}): K8sItem {
  return {
    metadata: makeMetadata({
      name,
      namespace: 'default',
      labels: opts.labels || { app: name },
      annotations: opts.annotations || {},
    }),
    spec: {
      replicas: opts.replicas ?? 2,
      selector: { matchLabels: opts.podLabels || { app: name } },
      strategy: { type: 'RollingUpdate' },
      template: {
        metadata: { labels: opts.podLabels || { app: name } },
        spec: {
          containers: [{ name, image: opts.image || `${name}:latest`, ports: [{ containerPort: 8080, protocol: 'TCP' }] }],
        },
      },
    },
    status: {
      replicas: opts.replicas ?? 2,
      readyReplicas: opts.ready ?? (opts.replicas ?? 2),
      updatedReplicas: opts.updated ?? (opts.replicas ?? 2),
      availableReplicas: opts.available ?? (opts.replicas ?? 2),
    },
  };
}

export function makeServiceItem(name: string, opts: {
  type?: string;
  clusterIP?: string;
  ports?: Array<{ port: number; targetPort: number; protocol?: string; name?: string }>;
  selector?: Record<string, string>;
} = {}): K8sItem {
  return {
    metadata: makeMetadata({ name, namespace: 'default', labels: { app: name } }),
    spec: {
      type: opts.type || 'ClusterIP',
      clusterIP: opts.clusterIP || '10.0.0.1',
      selector: opts.selector || { app: name },
      ports: opts.ports || [{ port: 80, targetPort: 8080, protocol: 'TCP', name: 'http' }],
    },
  };
}

export function makeConfigMapItem(name: string, data: Record<string, string> = {}): K8sItem {
  return {
    kind: 'ConfigMap',
    metadata: makeMetadata({ name, namespace: 'default' }),
    data,
  };
}

export function makeSecretItem(name: string, data: Record<string, string> = {}): K8sItem {
  return {
    kind: 'Secret',
    metadata: makeMetadata({ name, namespace: 'default' }),
    type: 'Opaque',
    data,
  };
}

export function makeStatefulSetItem(name: string, opts: { replicas?: number; ready?: number } = {}): K8sItem {
  return {
    kind: 'StatefulSet',
    metadata: makeMetadata({ name }),
    spec: { replicas: opts.replicas ?? 2, serviceName: `${name}-headless` },
    status: { replicas: opts.replicas ?? 2, readyReplicas: opts.ready ?? (opts.replicas ?? 2) },
  };
}

export function makeCronJobItem(name: string, opts: { schedule?: string; suspend?: boolean } = {}): K8sItem {
  return {
    kind: 'CronJob',
    metadata: makeMetadata({ name }),
    spec: { schedule: opts.schedule || '0 3 * * *', suspend: opts.suspend ?? false },
    status: { active: [] },
  };
}

export function makeJobItem(name: string, opts: { completions?: number; succeeded?: number } = {}): K8sItem {
  return {
    kind: 'Job',
    metadata: makeMetadata({ name }),
    spec: { completions: opts.completions ?? 1 },
    status: {
      succeeded: opts.succeeded ?? 1,
      startTime: '2026-01-01T00:00:00Z',
      completionTime: '2026-01-01T00:00:12Z',
    },
  };
}

export function makeEndpointsItem(name: string, addresses: string[] = ['10.0.0.5'], port = 8080): K8sItem {
  return {
    kind: 'Endpoints',
    metadata: makeMetadata({ name }),
    subsets: [{ addresses: addresses.map(ip => ({ ip })), ports: [{ port, protocol: 'TCP' }] }],
  };
}

/** A ReplicaSet owned by `deployment`, carrying the revision annotation that
 *  `kubectl rollout history` reads back. */
export function makeReplicaSetItem(name: string, deployment: string, revision: number, opts: {
  replicas?: number;
  changeCause?: string;
  image?: string;
} = {}): K8sItem {
  const annotations: Record<string, string> = { 'deployment.kubernetes.io/revision': String(revision) };
  if (opts.changeCause) annotations['kubernetes.io/change-cause'] = opts.changeCause;
  return {
    kind: 'ReplicaSet',
    metadata: makeMetadata({
      name,
      annotations,
      ownerReferences: [{ kind: 'Deployment', name: deployment }],
    }),
    spec: {
      replicas: opts.replicas ?? 1,
      template: {
        metadata: { labels: { app: deployment } },
        spec: { containers: [{ name: deployment, image: opts.image || `${deployment}:v${revision}` }] },
      },
    },
    status: { replicas: opts.replicas ?? 1, readyReplicas: opts.replicas ?? 1 },
  };
}

/** `kubectl get pods` table text, the shape the exporter writes to
 *  pods-snapshot.txt. Columns: NAME READY STATUS RESTARTS AGE IP NODE. */
export function makePodsSnapshotText(pods: Array<{
  name: string;
  ready?: string;
  status?: string;
  restarts?: number;
  age?: string;
  ip?: string;
  node?: string;
}>): string {
  const header = 'NAME                                      READY   STATUS    RESTARTS   AGE   IP            NODE          NOMINATED NODE   READINESS GATES';
  const rows = pods.map(p =>
    [
      p.name.padEnd(42),
      (p.ready || '1/1').padEnd(8),
      (p.status || 'Running').padEnd(10),
      String(p.restarts ?? 0).padEnd(11),
      (p.age || '3d').padEnd(6),
      (p.ip || '10.0.0.9').padEnd(14),
      (p.node || 'node-1').padEnd(14),
      '<none>'.padEnd(17),
      '<none>',
    ].join('')
  );
  return [header, ...rows].join('\n') + '\n';
}

/** Matching pods-images.txt: POD then IMAGE. */
export function makePodsImagesText(pods: Array<{ name: string; image: string }>): string {
  const rows = pods.map(p => `${p.name.padEnd(42)}${p.image}`);
  return ['POD                                       IMAGE', ...rows].join('\n') + '\n';
}
