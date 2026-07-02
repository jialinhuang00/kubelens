// Old snapshots have no replicasets.yaml — the emulator falls back to
// synthesizing RS rows from the owning Deployment. This file pins that legacy
// behavior against a fixture with deployments.yaml only.
// Env must be set before snapshot-loader is imported (BACKUP_PATH binds at load).
import './fixtures/env-legacy';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleCommand } from './snapshot-commands';

const NS = 'demo';

describe('legacy snapshot (no replicasets.yaml)', () => {
  it('get replicasets synthesizes <deployment>-<generation> rows', () => {
    const r = handleCommand(`kubectl get replicasets -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /orders-12/);
  });

  it('describe replicaset resolves the synthesized name to its deployment', () => {
    const r = handleCommand(`kubectl describe replicaset orders-12 -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /Name:\s+orders-12/);
    assert.match(r.stdout!, /order-service:aws-v3/);
  });

  it('rollout history degrades to the deployment revision annotation, no invented rows', () => {
    const r = handleCommand(`kubectl rollout history deployment/orders -n ${NS}`);
    assert.equal(r.success, true);
    const rows = r.stdout!.trim().split('\n').slice(2);
    assert.equal(rows.length, 1);
    assert.match(rows[0], /^7\s+/);
    assert.match(rows[0], /kubectl apply -f orders\.yaml/);
  });

  it('rollout status still derives from the deployment', () => {
    const r = handleCommand(`kubectl rollout status deployment/orders -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /"orders" successfully rolled out/);
  });
});
