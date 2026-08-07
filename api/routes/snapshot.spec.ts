import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';

/**
 * Route-level tests for the export control endpoint.
 *
 * `snapshot.js` resolves its snapshot directory once, at require time, from
 * `process.cwd()`. So the temp directory has to exist and be the cwd before the
 * module is loaded — hence the `require` inside `before()` rather than a normal
 * import at the top. `node --test` runs each spec file in its own process, so
 * the chdir cannot leak into another file's fixtures.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-routes-'));
  snapshotDir = path.join(tmpRoot, 'k8s-snapshot');
  fs.mkdirSync(snapshotDir, { recursive: true });
  process.chdir(tmpRoot);

  const express = require('express');
  const router = require(path.join(prevCwd, 'api', 'routes', 'snapshot.js'));
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  seedPartialExport();
  // Clears the in-memory dismissal left by whichever test ran last. The module
  // keeps one exportState for the process, so state does leak between tests.
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
