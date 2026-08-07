import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyProgressChunk, emptyProgressState } from './export-progress';
import type { ExporterMode } from './exporter-stdout.fixture';
import { EXPORTER_MODES, FIXTURE_DIR, exporterStdout, stripAnsi } from './exporter-stdout.fixture';

// Real captured stdout, one file per exporter, produced by
// scripts/capture-exporter-output.sh against a live cluster. Not typed by hand:
// the bug this guards against is the exporters printing something other than
// what the parser expects, and a typed sample is written from the same wrong
// belief as the parser. `npm run test:parity` re-captures and checks these are
// still what the exporters print.
describe('progress parsing, against what the exporters really print', () => {
  for (const mode of EXPORTER_MODES) {
    // The panel polls mid-export, so what matters is the state part-way through.
    // Feeding the whole run and asking for a non-empty set would be wrong: by the
    // last line every namespace is completed and every resource is done, and an
    // empty set is the right answer.
    const midRun = (mode: ExporterMode, stopBefore: RegExp): string => {
      const text = stripAnsi(exporterStdout(mode));
      const cut = text.search(stopBefore);
      assert.notEqual(cut, -1, `${mode}'s output never matched ${stopBefore}`);
      return text.slice(0, cut);
    };

    it(`sees which namespace the ${mode} exporter is on`, () => {
      const state = emptyProgressState();
      applyProgressChunk(state, midRun(mode, /✓ Namespace/));

      assert.deepEqual(
        [...state.activeNamespaces],
        ['demo'],
        `the panel's current namespace stays blank through the whole ${mode} export`,
      );
    });

    it(`sees what the ${mode} exporter is writing`, () => {
      // This is the "writing..." line in home.component.html, dead for the
      // default mode on Node and for every mode on Go.
      const state = emptyProgressState();
      applyProgressChunk(state, midRun(mode, /←/));

      assert.ok(
        state.activeResources.size > 0,
        `no resource was ever marked active from ${mode}'s output`,
      );
    });
  }

  it('covers every exporter script the route can spawn', () => {
    // The fixture set is only as good as its coverage: a sixth exporter added to
    // the route with no captured output would pass by not being tested. Read the
    // script names out of the route rather than listing them.
    const scriptToFixture: Record<string, ExporterMode> = {
      'snapshot-bash.sh': 'bash',
      'snapshot-node.js': 'node',
      'snapshot-node-workers.js': 'workers',
      'snapshot-node-procs.js': 'procs',
      'k8s-export': 'go',
    };

    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'snapshot.ts'), 'utf8');
    const spawned = new Set([
      ...[...route.matchAll(/'(snapshot-[a-z0-9-]+\.(?:js|sh))'/g)].map((m) => m[1]),
      ...[...route.matchAll(/'(k8s-export)'/g)].map((m) => m[1]),
    ]);
    assert.ok(spawned.size > 0, 'found no exporter scripts in the route — the pattern went stale');

    for (const script of spawned) {
      const fixture = scriptToFixture[script];
      assert.ok(fixture, `the route spawns ${script}, which has no entry in scriptToFixture`);
      assert.ok(
        fs.existsSync(path.join(FIXTURE_DIR, `${fixture}.txt`)),
        `the route spawns ${script} but test-fixtures/exporter-stdout/${fixture}.txt is missing`,
      );
    }
  });
});

describe('the tag every exporter prefixes its resource lines with', () => {
  it('has the same shape in all five', () => {
    // The bug: bash padded inside the brackets ("[demo    ]") and the other four
    // outside ("[demo]    "). Both look aligned in a terminal and only one
    // matches a pattern that assumes no whitespace between the brackets.
    const tags = new Map<string, string>();
    for (const mode of EXPORTER_MODES) {
      const line = stripAnsi(exporterStdout(mode))
        .split('\n')
        .find((l) => l.includes('fetching'));
      assert.ok(line, `${mode} printed no fetching line`);
      const tag = /→ (\[.*?\]\s*|\S*\s*)fetching/.exec(line!);
      assert.ok(tag, `${mode}: could not find a tag before "fetching" in ${JSON.stringify(line)}`);
      tags.set(mode, tag![1].replace(/\S+/g, 'X'));
    }
    const shapes = new Set(tags.values());
    assert.equal(
      shapes.size,
      1,
      `exporters disagree on the tag shape: ${JSON.stringify(Object.fromEntries(tags))}`,
    );
  });
});
