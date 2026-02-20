import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getResourceCounts } from './snapshot-handler';
import { cache } from './snapshot-loader';

// Populate the loader's in-memory cache directly to avoid filesystem/BACKUP_PATH issues.
// This mimics what loadYaml / loadText would have cached after reading real files.

const NS = 'test-ns';

before(() => {
  // Seed cache for loadYaml calls: key format is `${namespace}:${filename}`
  cache[`${NS}:deployments.yaml`] = {
    items: [
      { metadata: { name: 'web', namespace: NS } },
      { metadata: { name: 'api', namespace: NS } },
    ],
  };
  cache[`${NS}:services.yaml`] = {
    items: [
      { metadata: { name: 'web-svc', namespace: NS } },
    ],
  };
  cache[`${NS}:configmaps.yaml`] = { items: [] };
  cache[`${NS}:statefulsets.yaml`] = { items: [{ metadata: { name: 'db' } }] };

  // Seed cache for loadText: key format is `text:${namespace}:${filename}`
  cache[`text:${NS}:pods-snapshot.txt`] = [
    'NAME                    READY   STATUS    RESTARTS   AGE   IP            NODE',
    'web-abc-123             1/1     Running   0          5d    10.0.0.1      node1',
    'api-def-456             1/1     Running   2          3d    10.0.0.2      node1',
    'worker-ghi-789          0/1     Error     5          1d    10.0.0.3      node2',
  ].join('\n');
});

after(() => {
  // Clear cache entries we created
  for (const key of Object.keys(cache)) {
    if (key.includes(NS)) delete cache[key];
  }
});

describe('getResourceCounts', () => {
  it('counts pods from pods-snapshot.txt', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.pod, 3);
  });

  it('counts deployments from deployments.yaml', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.deployment, 2);
  });

  it('counts services from services.yaml', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.service, 1);
  });

  it('counts statefulsets from statefulsets.yaml', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.statefulsets, 1);
  });

  it('returns 0 for empty resources', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.configmaps, 0);
  });

  it('returns 0 for missing resource files (not in cache)', () => {
    const counts = getResourceCounts(NS);
    assert.equal(counts.cronjobs, 0);
    assert.equal(counts.secrets, 0);
  });

  it('returns 0 pods for non-existent namespace', () => {
    const counts = getResourceCounts('nonexistent-ns');
    assert.equal(counts.pod, 0);
  });
});
