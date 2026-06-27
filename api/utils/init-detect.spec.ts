import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCluster, classifyRegistry, buildCrdEntries } from './init-detect';
import { parseApiResources } from './api-resources';

describe('detectCluster', () => {
  it('detects EKS + region from server URL', () => {
    const c = detectCluster({ 'current-context': 'dev', clusters: [{ cluster: { server: 'https://ABC.gr7.us-east-1.eks.amazonaws.com' } }] });
    assert.equal(c.type, 'eks');
    assert.equal(c.region, 'us-east-1');
  });
  it('detects GKE + region from context name', () => {
    const c = detectCluster({ 'current-context': 'gke_my-proj_us-central1_my-cluster', clusters: [{ cluster: { server: 'https://1.2.3.4' } }] });
    assert.equal(c.type, 'gke');
    assert.equal(c.region, 'us-central1');
  });
  it('detects kind from context prefix', () => {
    const c = detectCluster({ 'current-context': 'kind-demo', clusters: [{ cluster: { server: 'https://127.0.0.1:6443' } }] });
    assert.equal(c.type, 'kind');
  });
  it('falls back to onprem', () => {
    assert.equal(detectCluster({ 'current-context': 'x', clusters: [{ cluster: { server: 'https://k8s.internal.corp' } }] }).type, 'onprem');
  });
});

describe('classifyRegistry', () => {
  it('votes ECR', () => {
    assert.equal(classifyRegistry(['123.dkr.ecr.us-east-1.amazonaws.com/app:1', '123.dkr.ecr.us-east-1.amazonaws.com/api:2']).type, 'ecr');
  });
  it('picks the majority on mixed', () => {
    const r = classifyRegistry(['gcr.io/p/a', 'gcr.io/p/b', 'nginx:latest']);
    assert.equal(r.type, 'gcr');
  });
  it('defaults to dockerhub for bare images', () => {
    assert.equal(classifyRegistry(['nginx:latest', 'redis:7']).type, 'dockerhub');
  });
});

describe('buildCrdEntries', () => {
  const SAMPLE = `NAME              SHORTNAMES   APIVERSION                     NAMESPACED   KIND
deployments       deploy       apps/v1                        true         Deployment
applications                   argoproj.io/v1alpha1           true         Application
httproutes                     gateway.networking.k8s.io/v1   true         HTTPRoute
virtualservices   vs           networking.istio.io/v1         true         VirtualService
leases                         coordination.k8s.io/v1         true         Lease`;
  const discovered = parseApiResources(SAMPLE);
  // group/Kind already shipped as built-ins in kubelens.default.yaml.
  const baseIds = new Set(['apps/Deployment']);

  it('skips kinds already in the base config', () => {
    assert.ok(!buildCrdEntries(discovered, baseIds).some(e => e.kind === 'Deployment'));
  });
  it('discovers Gateway API (under *.k8s.io but an installable CRD) with its curated graph view', () => {
    const hr = buildCrdEntries(discovered, baseIds).find(e => e.kind === 'HTTPRoute')!;
    assert.deepEqual(hr.show, ['graph']);
    assert.deepEqual(hr.default, []);
  });
  it('gives unknown CRDs a neutral tree entry, off by default', () => {
    const vs = buildCrdEntries(discovered, baseIds).find(e => e.kind === 'VirtualService')!;
    assert.deepEqual(vs.show, ['tree']);
    assert.deepEqual(vs.default, []);
    assert.equal(vs.resourceType, 'virtualservices.networking.istio.io');
  });
  it('honours excludeGroups', () => {
    assert.ok(!buildCrdEntries(discovered, baseIds, ['networking.istio.io']).some(e => e.kind === 'VirtualService'));
  });
});
