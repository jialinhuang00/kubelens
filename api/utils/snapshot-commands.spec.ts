// Env must be set before snapshot-loader is imported (BACKUP_PATH binds at load
// time), so the side-effect import comes first — static imports execute in order.
import './fixtures/env-snapshot';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKubectlCommand, handleCommand } from './snapshot-commands';

describe('parseKubectlCommand', () => {
  it('returns null for non-kubectl commands', () => {
    assert.equal(parseKubectlCommand('docker ps'), null);
    assert.equal(parseKubectlCommand('helm list'), null);
  });

  it('parses basic get pods', () => {
    const cmd = parseKubectlCommand('kubectl get pods');
    assert.equal(cmd?.action, 'get');
    assert.equal(cmd?.resource, 'pods');
    assert.equal(cmd?.namespace, undefined);
  });

  it('parses namespace flag -n', () => {
    const cmd = parseKubectlCommand('kubectl get pods -n kube-system');
    assert.equal(cmd?.action, 'get');
    assert.equal(cmd?.resource, 'pods');
    assert.equal(cmd?.namespace, 'kube-system');
  });

  it('parses --namespace flag', () => {
    const cmd = parseKubectlCommand('kubectl get deployments --namespace production');
    assert.equal(cmd?.namespace, 'production');
    assert.equal(cmd?.resource, 'deployments');
  });

  it('parses resource name', () => {
    const cmd = parseKubectlCommand('kubectl get deployment my-app -n dev');
    assert.equal(cmd?.resource, 'deployment');
    assert.equal(cmd?.resourceName, 'my-app');
    assert.equal(cmd?.namespace, 'dev');
  });

  it('parses describe command', () => {
    const cmd = parseKubectlCommand('kubectl describe deployment foo -n bar');
    assert.equal(cmd?.action, 'describe');
    assert.equal(cmd?.resource, 'deployment');
    assert.equal(cmd?.resourceName, 'foo');
    assert.equal(cmd?.namespace, 'bar');
  });

  it('parses -o json', () => {
    const cmd = parseKubectlCommand('kubectl get pods -o json -n ns1');
    assert.equal(cmd?.output, 'json');
    assert.equal(cmd?.namespace, 'ns1');
  });

  it('parses -o yaml', () => {
    const cmd = parseKubectlCommand('kubectl get svc my-svc -o yaml');
    assert.equal(cmd?.output, 'yaml');
  });

  it('parses -o wide', () => {
    const cmd = parseKubectlCommand('kubectl get nodes -o wide');
    assert.equal(cmd?.output, 'wide');
  });

  it('parses shorthand -ojson', () => {
    const cmd = parseKubectlCommand('kubectl get pods -ojson');
    assert.equal(cmd?.output, 'json');
  });

  it('parses --tail flag', () => {
    const cmd = parseKubectlCommand('kubectl logs my-pod -n ns --tail 50');
    assert.equal(cmd?.action, 'logs');
    assert.equal(cmd?.resource, 'my-pod');
    assert.equal(cmd?.flags.tail, '50');
  });

  it('parses --tail= flag', () => {
    const cmd = parseKubectlCommand('kubectl logs my-pod --tail=100');
    assert.equal(cmd?.flags.tail, '100');
  });

  it('parses rollout status', () => {
    const cmd = parseKubectlCommand('kubectl rollout status deployment/web -n prod');
    assert.equal(cmd?.action, 'rollout');
    assert.equal(cmd?.subAction, 'status');
    assert.equal(cmd?.resource, 'deployment/web');
    assert.equal(cmd?.namespace, 'prod');
  });

  it('parses rollout history', () => {
    const cmd = parseKubectlCommand('kubectl rollout history deployment/api');
    assert.equal(cmd?.action, 'rollout');
    assert.equal(cmd?.subAction, 'history');
    assert.equal(cmd?.resource, 'deployment/api');
  });

  it('parses rollout undo', () => {
    const cmd = parseKubectlCommand('kubectl rollout undo deployment/web');
    assert.equal(cmd?.subAction, 'undo');
  });

  it('parses config current-context', () => {
    const cmd = parseKubectlCommand('kubectl config current-context');
    assert.equal(cmd?.action, 'config');
    assert.equal(cmd?.subAction, 'current-context');
  });

  it('parses config get-contexts', () => {
    const cmd = parseKubectlCommand('kubectl config get-contexts');
    assert.equal(cmd?.subAction, 'get-contexts');
  });

  it('parses --all-namespaces / -A', () => {
    const cmd1 = parseKubectlCommand('kubectl get pods --all-namespaces');
    assert.equal(cmd1?.flags.allNamespaces, true);

    const cmd2 = parseKubectlCommand('kubectl get pods -A');
    assert.equal(cmd2?.flags.allNamespaces, true);
  });

  it('parses --no-headers', () => {
    const cmd = parseKubectlCommand('kubectl get pods --no-headers');
    assert.equal(cmd?.flags.noHeaders, true);
  });

  it('parses get all', () => {
    const cmd = parseKubectlCommand('kubectl get all -n ns1');
    assert.equal(cmd?.resource, 'all');
    assert.equal(cmd?.flags.getAll, true);
  });

  it('parses set image subcommand', () => {
    const cmd = parseKubectlCommand('kubectl set image deployment/web web=nginx:1.2');
    assert.equal(cmd?.action, 'set');
    assert.equal(cmd?.subAction, 'image');
    assert.equal(cmd?.resource, 'deployment/web');
  });

  it('parses -l label selector', () => {
    const cmd = parseKubectlCommand('kubectl get pods -l app=web');
    assert.equal(cmd?.flags.l, 'app=web');
  });

  it('parses -c container flag', () => {
    const cmd = parseKubectlCommand('kubectl logs my-pod -c sidecar');
    assert.equal(cmd?.flags.c, 'sidecar');
  });

  it('parses --revision flag', () => {
    const cmd = parseKubectlCommand('kubectl rollout history deployment/web --revision 3');
    assert.equal(cmd?.flags.revision, '3');
  });

  it('parses jsonpath output', () => {
    const cmd = parseKubectlCommand('kubectl get pods -o jsonpath={.items[*].metadata.name}');
    assert.equal(cmd?.output, 'jsonpath={.items[*].metadata.name}');
  });

  it('preserves raw command', () => {
    const raw = 'kubectl get pods -n test';
    const cmd = parseKubectlCommand(raw);
    assert.equal(cmd?.raw, raw);
  });
});

// --- handleCommand (integration tests against the committed fixture snapshot) ---
//
// The fixture (api/utils/fixtures/snapshot/) is a frozen export of the kind demo
// cluster (examples/), so shapes are exactly what the exporters write. Notable
// baked-in facts the tests below rely on:
//   - orders: revisions 1,2,3,5,6,8,9,10,11 (4 and 7 pruned), current 11 (aws-v2),
//     revision 2 carries a kubernetes.io/change-cause annotation
//   - gateway: 2/2 ready → "successfully rolled out"
//   - pod orders-cf4dd46db-5cf2f exists in pods.yaml + pods-snapshot.txt

const NS = 'demo';

describe('handleCommand — get', () => {
  it('get deployments returns table with header', () => {
    const r = handleCommand(`kubectl get deployments -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('READY'));
    assert.ok(r.stdout!.includes('orders'));
  });

  it('get deployment by name', () => {
    const r = handleCommand(`kubectl get deployment orders -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('orders'));
  });

  it('get deployment by name -o json', () => {
    const r = handleCommand(`kubectl get deployment orders -n ${NS} -o json`);
    assert.equal(r.success, true);
    const parsed = JSON.parse(r.stdout!);
    assert.equal(parsed.metadata.name, 'orders');
  });

  it('get deployment by name -o yaml', () => {
    const r = handleCommand(`kubectl get deployment orders -n ${NS} -o yaml`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('name: orders'));
  });

  it('get nonexistent resource returns error', () => {
    const r = handleCommand(`kubectl get deployment no-such-thing -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('NotFound'));
  });

  it('get services returns table', () => {
    const r = handleCommand(`kubectl get services -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('gateway'));
  });

  it('get pods returns snapshot text', () => {
    const r = handleCommand(`kubectl get pods -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('orders-'));
  });

  it('get pods --no-headers strips header', () => {
    const r = handleCommand(`kubectl get pods -n ${NS} --no-headers`);
    assert.equal(r.success, true);
    assert.ok(!r.stdout!.startsWith('NAME'));
  });

  it('get pods -o jsonpath returns names', () => {
    const r = handleCommand(`kubectl get pods -n ${NS} -o jsonpath={.items[*].metadata.name}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('orders-'));
  });

  it('get configmaps returns table', () => {
    const r = handleCommand(`kubectl get configmaps -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('DATA'));
  });

  it('get cronjobs returns table', () => {
    const r = handleCommand(`kubectl get cronjobs -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('SCHEDULE'));
    assert.ok(r.stdout!.includes('check-vault'));
  });

  it('get statefulsets returns table', () => {
    const r = handleCommand(`kubectl get statefulsets -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('READY'));
    assert.ok(r.stdout!.includes('scanner-worker'));
  });

  it('get jobs returns table', () => {
    const r = handleCommand(`kubectl get jobs -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('COMPLETIONS'));
  });

  it('get endpoints returns table', () => {
    const r = handleCommand(`kubectl get endpoints -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('ENDPOINTS'));
  });

  it('get namespaces returns list', () => {
    const r = handleCommand('kubectl get namespaces');
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('demo'));
  });

  it('get namespaces -o json', () => {
    const r = handleCommand('kubectl get namespaces -o json');
    assert.equal(r.success, true);
    const parsed = JSON.parse(r.stdout!);
    assert.equal(parsed.kind, 'NamespaceList');
    assert.ok(parsed.items.length > 0);
  });

  it('get nodes returns table', () => {
    const r = handleCommand('kubectl get nodes');
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('STATUS'));
    assert.ok(r.stdout!.includes('Ready'));
  });

  it('get nodes -o wide', () => {
    const r = handleCommand('kubectl get nodes -o wide');
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('INTERNAL-IP'));
    assert.ok(r.stdout!.includes('CONTAINER-RUNTIME'));
  });

  it('get events returns list', () => {
    const r = handleCommand(`kubectl get events -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('LAST SEEN'));
  });

  it('get all returns combined output', () => {
    const r = handleCommand(`kubectl get all -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('=== Deployment ==='));
    assert.ok(r.stdout!.includes('=== Service ==='));
  });

  it('get unknown resource returns error', () => {
    const r = handleCommand(`kubectl get foobar -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('Unknown resource'));
  });
});

describe('handleCommand — get replicasets (real snapshot data)', () => {
  it('lists real RS names with real counters', () => {
    const r = handleCommand(`kubectl get replicasets -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /DESIRED\s+CURRENT\s+READY/);
    assert.match(r.stdout!, /orders-cf4dd46db/);
    assert.match(r.stdout!, /gateway-999576696/);
  });

  it('named get returns only that RS', () => {
    const r = handleCommand(`kubectl get replicaset orders-cf4dd46db -n ${NS}`);
    assert.equal(r.success, true);
    const dataLines = r.stdout!.trim().split('\n').slice(1);
    assert.equal(dataLines.length, 1);
    assert.match(dataLines[0], /orders-cf4dd46db/);
  });

  it('rs shortname works', () => {
    const r = handleCommand(`kubectl get rs -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /orders-cf4dd46db/);
  });

  it('named get -o yaml returns the single object with its revision annotation', () => {
    const r = handleCommand(`kubectl get replicaset orders-7fcddfc598 -n ${NS} -o yaml`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /name: orders-7fcddfc598/);
    assert.match(r.stdout!, /deployment\.kubernetes\.io\/revision: ['"]2['"]/);
    assert.doesNotMatch(r.stdout!, /orders-cf4dd46db/);
  });

  it('unknown name is a NotFound error', () => {
    const r = handleCommand(`kubectl get replicaset nope-123 -n ${NS}`);
    assert.equal(r.success, false);
    assert.match(r.error!, /NotFound/);
  });
});

describe('handleCommand — describe', () => {
  it('describe deployment by name', () => {
    const r = handleCommand(`kubectl describe deployment orders -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('orders'));
    assert.ok(r.stdout!.includes('Replicas:'));
  });

  it('describe all deployments', () => {
    const r = handleCommand(`kubectl describe deployments -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
  });

  it('describe pod by name', () => {
    const r = handleCommand(`kubectl describe pod orders-cf4dd46db-5cf2f -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('orders'));
  });

  it('describe service by name', () => {
    const r = handleCommand(`kubectl describe service gateway -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('gateway'));
  });

  it('describe configmap (generic)', () => {
    const r = handleCommand(`kubectl describe configmap app-config -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('app-config'));
  });

  it('describe secret (generic)', () => {
    const r = handleCommand(`kubectl describe secret -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
  });

  it('describe replicaset uses the real RS, not a synthesized one', () => {
    const r = handleCommand(`kubectl describe replicaset orders-7fcddfc598 -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /Name:\s+orders-7fcddfc598/);
    assert.match(r.stdout!, /order-service:v1/);
    assert.match(r.stdout!, /pod-template-hash=7fcddfc598/);
  });

  it('describe nonexistent returns error', () => {
    const r = handleCommand(`kubectl describe configmap no-such -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('NotFound'));
  });
});

describe('handleCommand — rollout', () => {
  it('rollout status reports rolled out when ready >= desired', () => {
    const r = handleCommand(`kubectl rollout status deployment/gateway -n ${NS}`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /"gateway" successfully rolled out/);
  });

  it('rollout status on unknown deployment is NotFound', () => {
    const r = handleCommand(`kubectl rollout status deployment/nope -n ${NS}`);
    assert.equal(r.success, false);
    assert.match(r.error!, /NotFound/);
  });

  it('rollout history lists real revisions, preserving pruned gaps, sorted', () => {
    const r = handleCommand(`kubectl rollout history deployment/orders -n ${NS}`);
    assert.equal(r.success, true);
    const revisions = r.stdout!
      .trim()
      .split('\n')
      .slice(2) // drop "deployment.apps/orders" + header row
      .map(l => l.trim().split(/\s+/)[0]);
    assert.deepEqual(revisions, ['1', '2', '3', '5', '6', '8', '9', '10', '11']);
  });

  it('rollout history shows change-cause from the RS annotation', () => {
    const r = handleCommand(`kubectl rollout history deployment/orders -n ${NS}`);
    assert.match(r.stdout!, /kubectl set image deployment\/orders/);
  });

  it('rollout history scopes to the requested deployment', () => {
    const r = handleCommand(`kubectl rollout history deployment/gateway -n ${NS}`);
    const rows = r.stdout!.trim().split('\n').slice(2);
    assert.equal(rows.length, 3); // gateway has revisions 1,2,3
    assert.doesNotMatch(r.stdout!, /orders/);
  });

  it('rollout history --revision prints that revision pod template', () => {
    const r = handleCommand(`kubectl rollout history deployment/orders -n ${NS} --revision 2`);
    assert.equal(r.success, true);
    assert.match(r.stdout!, /with revision #2/);
    assert.match(r.stdout!, /order-service:v1/);
    assert.match(r.stdout!, /80\/TCP/);
  });

  it('rollout history --revision on a pruned revision errors', () => {
    const r = handleCommand(`kubectl rollout history deployment/orders -n ${NS} --revision 4`);
    assert.equal(r.success, false);
    assert.match(r.error!, /unable to find/);
  });
});

describe('handleCommand — error handling', () => {
  it('invalid command returns error', () => {
    const r = handleCommand('not-kubectl something');
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('parse'));
  });

  it('mutating command returns error', () => {
    const r = handleCommand(`kubectl delete pod foo -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('not supported'));
  });

  it('unsupported action returns error', () => {
    const r = handleCommand('kubectl taint nodes foo');
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('Unsupported'));
  });
});
