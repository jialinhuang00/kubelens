import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseApiResources } from './api-resources';

// Real-shaped `kubectl api-resources --verbs=list --namespaced=true` output.
// Note: SHORTNAMES column present for some rows, absent for others.
const SAMPLE = `NAME              SHORTNAMES   APIVERSION                     NAMESPACED   KIND
configmaps        cm           v1                             true         ConfigMap
services          svc          v1                             true         Service
deployments       deploy       apps/v1                        true         Deployment
applications                   argoproj.io/v1alpha1           true         Application
httproutes                     gateway.networking.k8s.io/v1   true         HTTPRoute`;

describe('parseApiResources', () => {
  it('parses core kinds (no group)', () => {
    const r = parseApiResources(SAMPLE).find(x => x.kind === 'ConfigMap')!;
    assert.equal(r.group, '');
    assert.equal(r.resourceType, 'configmaps');
  });

  it('parses grouped kinds right-anchored despite the SHORTNAMES column', () => {
    const r = parseApiResources(SAMPLE).find(x => x.kind === 'Deployment')!;
    assert.equal(r.group, 'apps');
    // group is always appended (group-qualified target); callers that have a
    // bare built-in name in config win on overlap, so this form is harmless.
    assert.equal(r.resourceType, 'deployments.apps');
  });

  it('parses CRDs with no shortname', () => {
    const app = parseApiResources(SAMPLE).find(x => x.kind === 'Application')!;
    assert.equal(app.group, 'argoproj.io');
    assert.equal(app.resourceType, 'applications.argoproj.io');
    const hr = parseApiResources(SAMPLE).find(x => x.kind === 'HTTPRoute')!;
    assert.equal(hr.resourceType, 'httproutes.gateway.networking.k8s.io');
  });

  it('drops the header by default, keeps all data rows', () => {
    assert.equal(parseApiResources(SAMPLE).length, 5);
  });

  it('handles --no-headers output when told to', () => {
    const noHeader = SAMPLE.split('\n').slice(1).join('\n');
    assert.equal(parseApiResources(noHeader, false).length, 5);
  });
});
