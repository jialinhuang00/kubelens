import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkloadEdges, buildGraph } from './graph-builder';
import type { GetItemsFn } from './graph-builder';
import type { K8sItem } from './snapshot-loader';
import { makeDeploymentItem, makeServiceItem, makeConfigMapItem } from './test-fixtures';

// --- extractWorkloadEdges ---

describe('extractWorkloadEdges', () => {
  it('does nothing when podSpec is undefined', () => {
    const nodes: Array<[string, string, string, string]> = [];
    const edgesList: Array<[string, string, string]> = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web', undefined,
      (ns, kind, name, cat) => { nodes.push([ns, kind, name, cat]); return `${ns}/${kind}/${name}`; },
      (s, t, type) => { edgesList.push([s, t, type]); },
    );
    assert.equal(nodes.length, 0);
    assert.equal(edgesList.length, 0);
  });

  it('extracts serviceAccountName reference', () => {
    const nodes: string[] = [];
    const edgesList: Array<{ source: string; target: string; type: string }> = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      { serviceAccountName: 'my-sa', containers: [] },
      (ns, kind, name, cat) => { nodes.push(`${ns}/${kind}/${name}`); return `${ns}/${kind}/${name}`; },
      (s, t, type) => { edgesList.push({ source: s, target: t, type }); },
    );
    assert.ok(nodes.includes('ns/ServiceAccount/my-sa'));
    assert.ok(edgesList.some(e => e.type === 'uses-serviceaccount'));
  });

  it('skips default serviceAccount', () => {
    const nodes: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      { serviceAccountName: 'default', containers: [] },
      (ns, kind, name) => { nodes.push(name); return `${ns}/${kind}/${name}`; },
      () => {},
    );
    assert.equal(nodes.length, 0);
  });

  it('extracts configmap from envFrom', () => {
    const edgeTypes: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      {
        containers: [{
          envFrom: [{ configMapRef: { name: 'app-config' } }],
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, _t, type) => { edgeTypes.push(type); },
    );
    assert.ok(edgeTypes.includes('uses-configmap'));
  });

  it('extracts secret from envFrom', () => {
    const edgeTypes: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      {
        containers: [{
          envFrom: [{ secretRef: { name: 'db-secret' } }],
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, _t, type) => { edgeTypes.push(type); },
    );
    assert.ok(edgeTypes.includes('uses-secret'));
  });

  it('extracts configmap from env.valueFrom.configMapKeyRef', () => {
    const targets: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      {
        containers: [{
          env: [{ name: 'DB_HOST', valueFrom: { configMapKeyRef: { name: 'db-config' } } }],
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, t) => { targets.push(t); },
    );
    assert.ok(targets.includes('ns/ConfigMap/db-config'));
  });

  it('extracts secret from env.valueFrom.secretKeyRef', () => {
    const targets: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'web',
      {
        containers: [{
          env: [{ name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db-cred' } } }],
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, t) => { targets.push(t); },
    );
    assert.ok(targets.includes('ns/Secret/db-cred'));
  });

  it('extracts PVC from volumes', () => {
    const edgeTypes: string[] = [];
    extractWorkloadEdges(
      'ns', 'StatefulSet', 'db',
      {
        containers: [],
        volumes: [{ persistentVolumeClaim: { claimName: 'data-vol' } }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, _t, type) => { edgeTypes.push(type); },
    );
    assert.ok(edgeTypes.includes('uses-pvc'));
  });

  it('extracts configmap and secret from volumes', () => {
    const targets: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'app',
      {
        containers: [],
        volumes: [
          { configMap: { name: 'vol-cm' } },
          { secret: { secretName: 'vol-sec' } },
        ],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, t) => { targets.push(t); },
    );
    assert.ok(targets.includes('ns/ConfigMap/vol-cm'));
    assert.ok(targets.includes('ns/Secret/vol-sec'));
  });

  it('extracts projected volume sources', () => {
    const targets: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'app',
      {
        containers: [],
        volumes: [{
          projected: {
            sources: [
              { configMap: { name: 'proj-cm' } },
              { secret: { name: 'proj-sec' } },
            ],
          },
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, t) => { targets.push(t); },
    );
    assert.ok(targets.includes('ns/ConfigMap/proj-cm'));
    assert.ok(targets.includes('ns/Secret/proj-sec'));
  });

  it('extracts initContainers refs', () => {
    const targets: string[] = [];
    extractWorkloadEdges(
      'ns', 'Deployment', 'app',
      {
        containers: [],
        initContainers: [{
          envFrom: [{ configMapRef: { name: 'init-cm' } }],
        }],
      },
      (ns, kind, name) => `${ns}/${kind}/${name}`,
      (_s, t) => { targets.push(t); },
    );
    assert.ok(targets.includes('ns/ConfigMap/init-cm'));
  });
});

// --- buildGraph ---

describe('buildGraph', () => {
  function createMockGetItems(): GetItemsFn {
    const data: Record<string, K8sItem[]> = {
      'ns1:deployments': [makeDeploymentItem('web', { podLabels: { app: 'web' } })],
      'ns1:services': [makeServiceItem('web-svc', { selector: { app: 'web' } })],
      'ns1:configmaps': [makeConfigMapItem('app-cfg', { key: 'val' })],
      'ns1:statefulsets': [],
      'ns1:daemonsets': [],
      'ns1:cronjobs': [],
      'ns1:httproutes': [],
      'ns1:tcproutes': [],
      'ns1:gateways': [],
      'ns1:ingresses': [],
      'ns1:horizontalpodautoscalers': [],
      'ns1:rolebindings': [],
      'ns1:pods': [],
    };
    return (ns: string, resource: string) => data[`${ns}:${resource}`] || [];
  }

  it('returns correct structure', () => {
    const result = buildGraph(createMockGetItems(), ['ns1']);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(Array.isArray(result.edges));
    assert.ok(typeof result.stats === 'object');
    assert.deepStrictEqual(result.namespaces, ['ns1']);
  });

  it('creates deployment and service nodes', () => {
    const result = buildGraph(createMockGetItems(), ['ns1']);
    const kinds = result.nodes.map(n => n.kind);
    assert.ok(kinds.includes('Deployment'));
    assert.ok(kinds.includes('Service'));
  });

  it('creates exposes edge between service and deployment', () => {
    const result = buildGraph(createMockGetItems(), ['ns1']);
    const exposesEdge = result.edges.find(e => e.type === 'exposes');
    assert.ok(exposesEdge, 'should have an exposes edge');
    assert.equal(exposesEdge!.source, 'ns1/Service/web-svc');
    assert.equal(exposesEdge!.target, 'ns1/Deployment/web');
  });

  it('picks up orphan configmaps', () => {
    const result = buildGraph(createMockGetItems(), ['ns1']);
    const cmNode = result.nodes.find(n => n.kind === 'ConfigMap' && n.name === 'app-cfg');
    assert.ok(cmNode, 'orphan configmap should be a node');
    assert.equal(cmNode!.metadata.orphan, true);
  });

  it('stats are accurate', () => {
    const result = buildGraph(createMockGetItems(), ['ns1']);
    assert.equal(result.stats.totalNodes, result.nodes.length);
    assert.equal(result.stats.totalEdges, result.edges.length);
    assert.equal(result.stats.namespaceCount, 1);
  });

  it('deduplicates nodes', () => {
    const getItems: GetItemsFn = (ns, resource) => {
      if (resource === 'deployments') {
        return [
          {
            metadata: { name: 'app', namespace: ns },
            spec: {
              replicas: 1,
              selector: { matchLabels: { app: 'app' } },
              template: {
                metadata: { labels: { app: 'app' } },
                spec: {
                  containers: [{ envFrom: [{ configMapRef: { name: 'shared' } }] }],
                  initContainers: [{ envFrom: [{ configMapRef: { name: 'shared' } }] }],
                },
              },
            },
          } as K8sItem,
        ];
      }
      if (resource === 'configmaps') return [makeConfigMapItem('shared')];
      return [];
    };
    const result = buildGraph(getItems, ['ns']);
    const sharedNodes = result.nodes.filter(n => n.name === 'shared' && n.kind === 'ConfigMap');
    assert.equal(sharedNodes.length, 1, 'ConfigMap "shared" should appear only once');
  });

  it('handles empty namespace list', () => {
    const result = buildGraph(() => [], []);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.edges.length, 0);
  });
});
