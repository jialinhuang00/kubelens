import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKubectlCommand, handleCommand } from './snapshot-commands';
import { cache } from './snapshot-loader';

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

// --- handleCommand (integration tests using real k8s-snapshot/demo dump) ---

const NS = 'demo';

describe('handleCommand — get', () => {
  it('get deployments returns table with header', () => {
    const r = handleCommand(`kubectl get deployments -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('READY'));
    assert.ok(r.stdout!.includes('api-server'));
  });

  it('get deployment by name', () => {
    const r = handleCommand(`kubectl get deployment api-server -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('api-server'));
  });

  it('get deployment by name -o json', () => {
    const r = handleCommand(`kubectl get deployment api-server -n ${NS} -o json`);
    assert.equal(r.success, true);
    const parsed = JSON.parse(r.stdout!);
    assert.equal(parsed.metadata.name, 'api-server');
  });

  it('get deployment by name -o yaml', () => {
    const r = handleCommand(`kubectl get deployment api-server -n ${NS} -o yaml`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('name: api-server'));
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
    assert.ok(r.stdout!.includes('api-server-svc'));
  });

  it('get pods returns snapshot text', () => {
    const r = handleCommand(`kubectl get pods -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('task-runner'));
  });

  it('get pods --no-headers strips header', () => {
    const r = handleCommand(`kubectl get pods -n ${NS} --no-headers`);
    assert.equal(r.success, true);
    assert.ok(!r.stdout!.startsWith('NAME'));
  });

  it('get pods -o jsonpath returns names', () => {
    const r = handleCommand(`kubectl get pods -n ${NS} -o jsonpath={.items[*].metadata.name}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('task-runner'));
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
    assert.ok(r.stdout!.includes('DEPLOYMENT'));
    assert.ok(r.stdout!.includes('SERVICE'));
  });

  it('get replicasets returns table', () => {
    const r = handleCommand(`kubectl get replicasets -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('NAME'));
    assert.ok(r.stdout!.includes('DESIRED'));
  });

  it('get unknown resource returns error', () => {
    const r = handleCommand(`kubectl get foobar -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('Unknown resource'));
  });
});

describe('handleCommand — describe', () => {
  it('describe deployment by name', () => {
    const r = handleCommand(`kubectl describe deployment api-server -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('api-server'));
    assert.ok(r.stdout!.includes('Replicas:'));
  });

  it('describe all deployments', () => {
    const r = handleCommand(`kubectl describe deployments -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
  });

  it('describe pod by name', () => {
    const r = handleCommand(`kubectl describe pod task-runner-74d7bff595-nq667 -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('task-runner'));
  });

  it('describe service by name', () => {
    const r = handleCommand(`kubectl describe service api-server-svc -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('api-server-svc'));
  });

  it('describe configmap (generic)', () => {
    const r = handleCommand(`kubectl describe configmap config -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
    assert.ok(r.stdout!.includes('config'));
  });

  it('describe secret (generic)', () => {
    const r = handleCommand(`kubectl describe secret -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('Name:'));
  });

  it('describe nonexistent returns error', () => {
    const r = handleCommand(`kubectl describe configmap no-such -n ${NS}`);
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('NotFound'));
  });
});

describe('handleCommand — rollout', () => {
  it('rollout status', () => {
    const r = handleCommand(`kubectl rollout status deployment/api-server -n ${NS}`);
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('api-server'));
  });

  it('rollout history', () => {
    const r = handleCommand('kubectl rollout history deployment/web');
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('REVISION'));
  });

  it('rollout history --revision', () => {
    const r = handleCommand('kubectl rollout history deployment/web --revision 2');
    assert.equal(r.success, true);
    assert.ok(r.stdout!.includes('revision #2'));
  });

});

describe('handleCommand — error handling', () => {
  it('invalid command returns error', () => {
    const r = handleCommand('not-kubectl something');
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('parse'));
  });

  it('unsupported action returns error', () => {
    const r = handleCommand('kubectl taint nodes foo');
    assert.equal(r.success, false);
    assert.ok(r.error!.includes('Unsupported'));
  });
});
