import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PKG_ROOT } from './paths';
import { applyProgressChunk, emptyProgressState } from './export-progress';
import { EXPORTER_MODES, FIXTURE_DIR, stripAnsi } from './exporter-stdout.fixture';

/**
 * The committed captures under test-fixtures/exporter-stdout are the only reason
 * the two progress parsers can be tested without a cluster. They are real output,
 * which is the point, but real output taken once: change what an exporter prints
 * and the captures keep describing the old behaviour, exactly the way the
 * hand-typed samples they replaced did.
 *
 * So this re-runs the capture against a live cluster and checks the committed
 * files still describe what the exporters print. It compares the parse, not the
 * bytes: durations, file counts and namespace order differ every run, and a diff
 * on those would fail constantly and get ignored.
 *
 * `.itest.ts`, run by `npm run test:parity`, for the same reason as the sibling
 * file: it starts real exporters, and `test:utils` is supposed to make zero
 * external calls.
 */

function usable(binary: string, probeArgs: string[]): boolean {
  try {
    execFileSync(binary, probeArgs, { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const haveCluster = usable('kubectl', ['config', 'current-context']);
const haveGo = usable('go', ['version']);

/** What the parser makes of one exporter's output, at the point the panel polls. */
function parseUpTo(text: string, stopBefore: string) {
  const clean = stripAnsi(text);
  const cut = clean.indexOf(stopBefore);
  const state = emptyProgressState();
  applyProgressChunk(state, cut < 0 ? clean : clean.slice(0, cut));
  return state;
}

describe('the committed exporter captures still describe what the exporters print', () => {
  if (!haveCluster || !haveGo) {
    it('skipped: needs a reachable cluster and a Go toolchain', { skip: true }, () => {});
    return;
  }

  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-capture-'));
  let captured = false;
  try {
    execFileSync('bash', [path.join(PKG_ROOT, 'scripts', 'capture-exporter-output.sh'), fresh], {
      cwd: PKG_ROOT,
      stdio: 'pipe',
      timeout: 300_000,
    });
    captured = true;
  } catch (err) {
    it('capture failed', () => assert.fail(`scripts/capture-exporter-output.sh: ${err}`));
  }

  if (!captured) return;

  for (const mode of EXPORTER_MODES) {
    it(`${mode}: the parser reads the fresh output the same way`, () => {
      const live = fs.readFileSync(path.join(fresh, `${mode}.txt`), 'utf8');
      const committed = fs.readFileSync(path.join(FIXTURE_DIR, `${mode}.txt`), 'utf8');

      for (const [label, stopBefore] of [['namespace', '✓ Namespace'], ['resource', '←']] as const) {
        const a = parseUpTo(live, stopBefore);
        const b = parseUpTo(committed, stopBefore);
        assert.equal(
          a.activeNamespaces.size > 0,
          b.activeNamespaces.size > 0,
          `${mode} ${label}: the committed capture is stale — recapture with scripts/capture-exporter-output.sh`,
        );
        assert.equal(
          a.activeResources.size > 0,
          b.activeResources.size > 0,
          `${mode} ${label}: the committed capture is stale — recapture with scripts/capture-exporter-output.sh`,
        );
      }
    });
  }
});
