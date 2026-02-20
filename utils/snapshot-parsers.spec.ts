import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNames, findItem, pad, getAge, getDuration,
  generateDeploymentTable, generateServiceTable, generateConfigmapTable,
  generateCronjobTable, generateStatefulsetTable, generateJobTable, generateEndpointTable,
  generateDeploymentDescribe, generateServiceDescribe, generateGenericDescribe,
} from './snapshot-parsers';
import { makeItem, makeList, makeDeploymentItem, makeServiceItem, makeConfigMapItem, makeMetadata } from './test-fixtures';

// --- extractNames ---

describe('extractNames', () => {
  it('returns names from a K8sList', () => {
    const list = makeList([
      makeItem({ metadata: { name: 'a', namespace: 'ns' } }),
      makeItem({ metadata: { name: 'b', namespace: 'ns' } }),
    ]);
    assert.deepStrictEqual(extractNames(list), ['a', 'b']);
  });

  it('returns [] for null input', () => {
    assert.deepStrictEqual(extractNames(null), []);
  });

  it('returns [] for empty items', () => {
    assert.deepStrictEqual(extractNames({ items: [] }), []);
  });

  it('filters out items without metadata.name', () => {
    const list = makeList([
      makeItem({ metadata: { name: 'a', namespace: 'ns' } }),
      { metadata: {} as any },
    ]);
    assert.deepStrictEqual(extractNames(list), ['a']);
  });
});

// --- findItem ---

describe('findItem', () => {
  const list = makeList([
    makeItem({ metadata: { name: 'alpha', namespace: 'ns' } }),
    makeItem({ metadata: { name: 'beta', namespace: 'ns' } }),
  ]);

  it('finds an existing item by name', () => {
    const item = findItem(list, 'alpha');
    assert.equal(item?.metadata.name, 'alpha');
  });

  it('returns null when item not found', () => {
    assert.equal(findItem(list, 'nope'), null);
  });

  it('returns null for null input', () => {
    assert.equal(findItem(null, 'x'), null);
  });
});

// --- pad ---

describe('pad', () => {
  it('pads short string with spaces', () => {
    assert.equal(pad('hi', 5), 'hi   ');
  });

  it('returns string unchanged when equal to length', () => {
    assert.equal(pad('hello', 5), 'hello');
  });

  it('returns string unchanged when longer than length', () => {
    assert.equal(pad('toolong', 3), 'toolong');
  });

  it('converts non-string to string', () => {
    assert.equal(pad(42, 5), '42   ');
  });

  it('converts null/undefined to empty string', () => {
    assert.equal(pad(null, 3), '   ');
    assert.equal(pad(undefined, 3), '   ');
  });
});

// --- getDuration ---

describe('getDuration', () => {
  it('returns seconds for short durations', () => {
    assert.equal(getDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:30Z'), '30s');
  });

  it('returns minutes+seconds for moderate durations', () => {
    assert.equal(getDuration('2026-01-01T00:00:00Z', '2026-01-01T00:05:30Z'), '5m30s');
  });

  it('returns hours+minutes for long durations', () => {
    assert.equal(getDuration('2026-01-01T00:00:00Z', '2026-01-01T02:30:00Z'), '2h30m');
  });

  it('returns 0s for equal timestamps', () => {
    assert.equal(getDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), '0s');
  });
});

// --- getAge ---

describe('getAge', () => {
  it('returns <unknown> for undefined', () => {
    assert.equal(getAge(undefined), '<unknown>');
  });

  it('returns a string matching pattern \\d+[mhd]', () => {
    const age = getAge('2025-01-01T00:00:00Z');
    assert.match(age, /^\d+[mhd]$/);
  });

  it('returns days for old timestamps', () => {
    const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
    const age = getAge(oneYearAgo);
    assert.match(age, /^\d+d$/);
  });

  it('returns minutes for very recent timestamps', () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60000).toISOString();
    assert.equal(getAge(twoMinAgo), '2m');
  });
});

// --- generateDeploymentTable ---

describe('generateDeploymentTable', () => {
  it('generates header + rows', () => {
    const items = [makeDeploymentItem('web', { replicas: 3, ready: 3, updated: 3, available: 3 })];
    const table = generateDeploymentTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('NAME'));
    assert.ok(lines[0].includes('READY'));
    assert.ok(lines[1].includes('web'));
    assert.ok(lines[1].includes('3/3'));
  });

  it('returns only header for empty items', () => {
    const table = generateDeploymentTable([]);
    const lines = table.split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('NAME'));
  });
});

// --- generateServiceTable ---

describe('generateServiceTable', () => {
  it('generates correct table rows', () => {
    const items = [makeServiceItem('api', {
      type: 'LoadBalancer',
      ports: [{ port: 443, targetPort: 8443, protocol: 'TCP' }],
    })];
    const table = generateServiceTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('api'));
    assert.ok(lines[1].includes('LoadBalancer'));
    assert.ok(lines[1].includes('443/TCP'));
  });
});

// --- generateConfigmapTable ---

describe('generateConfigmapTable', () => {
  it('counts data keys', () => {
    const items = [makeConfigMapItem('cfg', { key1: 'v1', key2: 'v2' })];
    const table = generateConfigmapTable(items);
    const lines = table.split('\n');
    assert.ok(lines[1].includes('cfg'));
    assert.ok(lines[1].includes('2'));
  });

  it('shows 0 for configmap with no data', () => {
    const items = [makeConfigMapItem('empty')];
    const table = generateConfigmapTable(items);
    assert.ok(table.split('\n')[1].includes('0'));
  });
});

// --- generateCronjobTable ---

describe('generateCronjobTable', () => {
  it('generates header + rows with schedule', () => {
    const items = [{
      metadata: makeMetadata({ name: 'backup-job' }),
      spec: { schedule: '0 2 * * *', suspend: false },
      status: { active: [], lastScheduleTime: '2026-01-01T02:00:00Z' },
    }];
    const table = generateCronjobTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('SCHEDULE'));
    assert.ok(lines[1].includes('backup-job'));
    assert.ok(lines[1].includes('0 2 * * *'));
    assert.ok(lines[1].includes('False'));
  });

  it('shows suspended cronjob', () => {
    const items = [{
      metadata: makeMetadata({ name: 'paused' }),
      spec: { schedule: '*/5 * * * *', suspend: true },
      status: {},
    }];
    const table = generateCronjobTable(items);
    assert.ok(table.split('\n')[1].includes('True'));
  });
});

// --- generateStatefulsetTable ---

describe('generateStatefulsetTable', () => {
  it('generates header + rows', () => {
    const items = [{
      metadata: makeMetadata({ name: 'redis' }),
      spec: { replicas: 3 },
      status: { readyReplicas: 3 },
    }];
    const table = generateStatefulsetTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('READY'));
    assert.ok(lines[1].includes('redis'));
    assert.ok(lines[1].includes('3/3'));
  });
});

// --- generateJobTable ---

describe('generateJobTable', () => {
  it('generates header + rows with duration', () => {
    const items = [{
      metadata: makeMetadata({ name: 'migrate' }),
      spec: { completions: 1 },
      status: {
        succeeded: 1,
        startTime: '2026-01-01T00:00:00Z',
        completionTime: '2026-01-01T00:00:45Z',
      },
    }];
    const table = generateJobTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('COMPLETIONS'));
    assert.ok(lines[1].includes('migrate'));
    assert.ok(lines[1].includes('1/1'));
    assert.ok(lines[1].includes('45s'));
  });

  it('shows <none> duration for incomplete jobs', () => {
    const items = [{
      metadata: makeMetadata({ name: 'running' }),
      spec: { completions: 1 },
      status: { succeeded: 0, startTime: '2026-01-01T00:00:00Z' },
    }];
    const table = generateJobTable(items);
    assert.ok(table.split('\n')[1].includes('<none>'));
  });
});

// --- generateEndpointTable ---

describe('generateEndpointTable', () => {
  it('generates header + endpoint addresses', () => {
    const items = [{
      metadata: makeMetadata({ name: 'web-ep' }),
      subsets: [{
        addresses: [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }],
        ports: [{ port: 8080 }],
      }],
    }];
    const table = generateEndpointTable(items);
    const lines = table.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('10.0.0.1:8080'));
    assert.ok(lines[1].includes('10.0.0.2:8080'));
  });

  it('shows <none> for endpoints without subsets', () => {
    const items = [{ metadata: makeMetadata({ name: 'empty-ep' }) }];
    const table = generateEndpointTable(items);
    assert.ok(table.split('\n')[1].includes('<none>'));
  });
});

// --- generateDeploymentDescribe ---

describe('generateDeploymentDescribe', () => {
  it('returns not-found for null', () => {
    const out = generateDeploymentDescribe(null);
    assert.ok(out.includes('NotFound'));
  });

  it('renders deployment details', () => {
    const item = makeDeploymentItem('web', {
      replicas: 3, ready: 3, updated: 3, available: 3,
      labels: { app: 'web', tier: 'frontend' },
      annotations: { 'kubectl.kubernetes.io/restartedAt': '2026-01-01' },
      image: 'nginx:1.25',
    });
    const out = generateDeploymentDescribe(item);
    assert.ok(out.includes('Name:                   web'));
    assert.ok(out.includes('Namespace:              default'));
    assert.ok(out.includes('app=web'));
    assert.ok(out.includes('nginx:1.25'));
    assert.ok(out.includes('Replicas:'));
    assert.ok(out.includes('3 desired'));
    assert.ok(out.includes('StrategyType:'));
    assert.ok(out.includes('Pod Template:'));
  });
});

// --- generateServiceDescribe ---

describe('generateServiceDescribe', () => {
  it('returns not-found for null', () => {
    const out = generateServiceDescribe(null);
    assert.ok(out.includes('NotFound'));
  });

  it('renders service details', () => {
    const svc = makeServiceItem('my-svc', { type: 'NodePort', selector: { app: 'web' } });
    const out = generateServiceDescribe(svc);
    assert.ok(out.includes('Name:              my-svc'));
    assert.ok(out.includes('NodePort'));
    assert.ok(out.includes('app=web'));
  });
});

// --- generateGenericDescribe ---

describe('generateGenericDescribe', () => {
  it('returns not-found for null', () => {
    const out = generateGenericDescribe(null);
    assert.ok(out.includes('NotFound'));
  });

  it('renders name, namespace, kind', () => {
    const item = makeConfigMapItem('my-cm', { a: '1' });
    const out = generateGenericDescribe(item);
    assert.ok(out.includes('my-cm'));
    assert.ok(out.includes('ConfigMap'));
    assert.ok(out.includes('Data:'));
    assert.ok(out.includes('a'));
  });

  it('renders type for secrets', () => {
    const secret = { ...makeConfigMapItem('s'), kind: 'Secret', type: 'Opaque' };
    const out = generateGenericDescribe(secret);
    assert.ok(out.includes('Type:              Opaque'));
  });
});
