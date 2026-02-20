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
  return {
    metadata: makeMetadata(),
    ...overrides,
    metadata: { ...makeMetadata(), ...overrides.metadata } as K8sMetadata,
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
