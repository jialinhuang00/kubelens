import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadTables } from './config-loader';
import { renderTable } from './snapshot-parsers';
import { OutputParserService } from '../../src/app/features/dashboard/services/output-parser.service';
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './paths';

const items: Record<string, { metadata?: { name: string } }> = JSON.parse(
  fs.readFileSync(path.join(PKG_ROOT, 'test-fixtures', 'table-items.json'), 'utf8'),
);

/**
 * OutputParserService decides what every command's output *is* — table, multiple
 * tables, YAML, or raw text — and it had no tests at all. That is where 0.3.0's
 * merged columns lived: the backend emitted text nobody could split, and no
 * suite on either side looked at the reader.
 *
 * table-roundtrip.spec.ts covers the table branch against the real renderer.
 * This file covers what stays true without a snapshot on disk: every kind the
 * config declares must render as text the parser recognises as a table.
 *
 * The cases that need real command output live in output-parser.itest.ts —
 * test:utils points K8S_SNAPSHOT_PATH at a nonexistent directory on purpose, so
 * anything calling handleCommand belongs on the other side of that line.
 *
 * Runs under node:test rather than Karma because it feeds the parser real
 * backend output. The service has no injected dependencies, so `new` is enough.
 */

const parser = new OutputParserService();
const parse = (out: string, cmd = '') => parser.parseCommandOutput(out, cmd);

describe('every kind the config declares renders as a table the parser accepts', () => {
  // The generic version of the 0.3.0 failure: a kind whose text the reader
  // cannot recognise as a table at all, rather than one it mis-splits.
  for (const kind of Object.keys(loadTables())) {
    it(`${kind}`, () => {
      const spec = loadTables()[kind];
      // Real fixture items, two rows with different names. Empty objects would
      // render blank rows, which are legitimately not a table — that would be
      // testing the fixture, not the parser.
      const a = items[kind];
      const b = JSON.parse(JSON.stringify(a));
      b.metadata.name = a.metadata!.name + '-2';
      const text = renderTable(spec, [a, b] as never);
      const r = parse(text, `kubectl get ${kind.toLowerCase()}`);
      assert.equal(r.type, 'table', `${kind} was read as ${r.type}:\n${text}`);
      assert.deepEqual(r.headers, spec.columns.map(c => c.name));
    });
  }
});
