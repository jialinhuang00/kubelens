import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';

import snapshotRouter from './snapshot';
import { kubectlContext } from '../utils/kubectl-context';

/**
 * Route-level tests for the export control endpoint.
 *
 * Plain top-level imports. The route resolves its snapshot directory per call
 * rather than at import, so loading it here does not freeze a path before the
 * chdir below — an earlier version had to `require` it inside `before()`, and
 * that late require is what let the route and this spec end up with two copies
 * of a shared module.
 *
 * `node --test` gives each spec file its own process, so the chdir cannot leak
 * into another file's fixtures.
 *
 * No mocks: a real Express app on an ephemeral port, driven with the fetch that
 * Node ships. Everything asserted here is either a file on disk or a field in
 * the JSON the frontend actually reads.
 */

let tmpRoot: string;
let snapshotDir: string;
let prevCwd: string;
let server: Server;
let baseUrl: string;
let prevSnapshotEnv: string | undefined;
/** Set per test; the real kubectl is never reached. */
let stubbedContext: string | null = null;

/** POST /api/snapshot with a command body. */
async function post(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

async function progress() {
  const res = await fetch(`${baseUrl}/api/snapshot`);
  return await res.json() as any;
}

/** A partial export: files on disk, no completion marker. That is "paused". */
function seedPartialExport() {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(snapshotDir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'demo', 'pods.yaml'), 'items: []\n');
}

before(async () => {
  prevCwd = process.cwd();
  // realpath, because on macOS os.tmpdir() hands back /var/... while chdir
  // resolves the symlink to /private/var/... — and the guard below compares
  // this against what the route resolves after the chdir.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-routes-')));
  snapshotDir = path.join(tmpRoot, 'k8s-snapshot');
  fs.mkdirSync(snapshotDir, { recursive: true });
  process.chdir(tmpRoot);

  // `test:utils` points this at a nonexistent path so nothing reads a real
  // export, and the app honours it above the working directory. Aim it at the
  // temp directory instead: chdir alone no longer decides where the route looks.
  prevSnapshotEnv = process.env.K8S_SNAPSHOT_PATH;
  process.env.K8S_SNAPSHOT_PATH = snapshotDir;

  // Replace the live-cluster lookup before the route can call it. Left alone it
  // shells out to whatever kubeconfig this machine has: unassertable, and a unit
  // test reading the developer's cluster settings. Same module object the route
  // imported, because both sides are TypeScript and resolve identically.
  kubectlContext.current = async () => stubbedContext;

  const app = express();
  app.use(express.json());
  app.use('/api', snapshotRouter);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Two self-checks before a single test runs. Both cover failures that are
  // silent where they happen and only surface later as something else.

  // 1. These tests send `discard`, which is `rm -rf` on whatever directory the
  //    route resolved. Ask the route what it sees rather than recomputing the
  //    path here: a stale compiled copy that froze its directory at import,
  //    before the chdir above, would still be pointing at the repo, and
  //    recomputing would agree with the temp path and prove nothing. That
  //    mistake deleted the repo's real k8s-snapshot twice.
  fs.writeFileSync(path.join(snapshotDir, 'guard-probe.yaml'), 'items: []\n');
  const seen = await progress();
  fs.rmSync(path.join(snapshotDir, 'guard-probe.yaml'));
  if (seen.fileCount !== 1) {
    throw new Error(
      `refusing to run: the route reports ${seen.fileCount} files where the temp directory has 1, ` +
      `so it is reading somewhere else — probably a stale api/routes/snapshot.js from an older ` +
      `build. Run \`npm run build:server\`, or delete api/routes/*.js.`
    );
  }

  // 2. The stub has to be the object the route actually calls. Assigning a
  //    property on the wrong copy of a module always succeeds, so a missed stub
  //    showed up three layers away as a context name that did not match.
  const viaRoute = await kubectlContext.current();
  if (viaRoute !== stubbedContext) {
    throw new Error(`kubectl stub did not take: got ${viaRoute}, expected ${stubbedContext}`);
  }
});

after(() => {
  server?.close();
  process.chdir(prevCwd);
  if (prevSnapshotEnv === undefined) delete process.env.K8S_SNAPSHOT_PATH;
  else process.env.K8S_SNAPSHOT_PATH = prevSnapshotEnv;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  stubbedContext = null;
  // discard is the reset: it deletes the directory *and* clears the in-memory
  // dismissal the previous test may have set. The module keeps one exportState
  // for the whole process, so that flag really does leak between tests. Seeding
  // has to come after, or the discard would delete what was just seeded.
  await post({ command: 'discard' });
  seedPartialExport();
});

describe('GET /api/snapshot', () => {
  it('reports paused when files exist without a completion marker', async () => {
    const p = await progress();
    assert.equal(p.paused, true);
    assert.equal(p.fileCount, 1);
  });

  it('reports not paused once .export-complete is written', async () => {
    fs.writeFileSync(path.join(snapshotDir, '.export-complete'), '{}\n');
    assert.equal((await progress()).paused, false);
  });

  it('is not paused with an empty directory — nothing to resume', async () => {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    fs.mkdirSync(snapshotDir, { recursive: true });
    const p = await progress();
    assert.equal(p.paused, false);
    assert.equal(p.fileCount, 0);
  });

  it('returns the cluster recorded in .export-context', async () => {
    fs.writeFileSync(
      path.join(snapshotDir, '.export-context'),
      JSON.stringify({ context: 'kind-kubelens-demo', startedAt: '2026-08-06T19:15:31Z' }) + '\n',
    );
    assert.equal((await progress()).snapshotContext, 'kind-kubelens-demo');
  });

  it('returns null for a snapshot exported before contexts were recorded', async () => {
    assert.equal((await progress()).snapshotContext, null);
  });

  it('returns null rather than a name for a corrupt .export-context', async () => {
    fs.writeFileSync(path.join(snapshotDir, '.export-context'), 'not json at all\n');
    assert.equal((await progress()).snapshotContext, null);
  });

  it('returns the live kubectl context beside the recorded one', async () => {
    stubbedContext = 'kind-kubelens-demo';
    fs.writeFileSync(
      path.join(snapshotDir, '.export-context'),
      JSON.stringify({ context: 'kind-kubelens-demo' }) + '\n',
    );
    const p = await progress();
    assert.equal(p.snapshotContext, 'kind-kubelens-demo');
    assert.equal(p.currentContext, 'kind-kubelens-demo');
  });

  // The case the panel turns red for: same directory, two clusters.
  it('reports the two contexts separately when they differ', async () => {
    stubbedContext = 'arn:aws:eks:ap-northeast-1:000000000000:cluster/staging';
    fs.writeFileSync(
      path.join(snapshotDir, '.export-context'),
      JSON.stringify({ context: 'kind-kubelens-demo' }) + '\n',
    );
    const p = await progress();
    assert.equal(p.snapshotContext, 'kind-kubelens-demo');
    assert.equal(p.currentContext, 'arn:aws:eks:ap-northeast-1:000000000000:cluster/staging');
    assert.notEqual(p.snapshotContext, p.currentContext);
  });

  it('reports a null live context when kubectl has none', async () => {
    stubbedContext = null;
    assert.equal((await progress()).currentContext, null);
  });

  it('skips the context lookup entirely when not paused', async () => {
    fs.writeFileSync(path.join(snapshotDir, '.export-complete'), '{}\n');
    fs.writeFileSync(path.join(snapshotDir, '.export-context'), JSON.stringify({ context: 'kind-kubelens-demo' }));
    const p = await progress();
    assert.equal(p.snapshotContext, null);
    assert.equal(p.currentContext, null);
  });
});

describe('POST /api/snapshot', () => {
  // The regression this guards: paused is recomputed from disk on every poll,
  // so a dismiss that only cleared the in-memory flag was undone a second later.
  it('clear stops the paused state coming back on the next poll', async () => {
    const { status, body } = await post({ command: 'clear' });
    assert.equal(status, 200);
    assert.equal(body.cleared, true);

    assert.equal((await progress()).paused, false);
    assert.equal((await progress()).paused, false, 'the dismissal did not survive a second poll');
  });

  it('discard deletes the snapshot directory', async () => {
    const { status, body } = await post({ command: 'discard' });
    assert.equal(status, 200);
    assert.equal(body.discarded, true);
    assert.equal(fs.existsSync(snapshotDir), false);

    const p = await progress();
    assert.equal(p.paused, false);
    assert.equal(p.fileCount, 0);
  });

  // Discard re-arms the panel: the next partial export has to show it again.
  it('discard clears a previous dismissal', async () => {
    await post({ command: 'clear' });
    await post({ command: 'discard' });
    seedPartialExport();
    assert.equal((await progress()).paused, true);
  });

  it('stop is rejected when nothing is running', async () => {
    const { status, body } = await post({ command: 'stop' });
    assert.equal(status, 400);
    assert.equal(body.error, 'No export running');
  });

  // No test drives `command: 'start'`. Every mode spawns a real exporter, which
  // reads the live cluster from whatever kubeconfig the machine has — a unit
  // test has no business doing that. Covering the mode-to-command mapping needs
  // that switch pulled out of the handler first, the way the Go port did it
  // (`exporterCommand` in cmd/server/routes/k8s_export.go, tested directly).
});
