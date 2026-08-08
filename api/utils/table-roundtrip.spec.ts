import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PKG_ROOT } from './paths';
import { loadTables } from './config-loader';
import { renderTable } from './snapshot-parsers';
import { OutputParserService } from '../../src/app/features/dashboard/services/output-parser.service';

/**
 * The backend renders a table to text; the frontend splits that text back into
 * cells. Two implementations of one format, and until 2026-08-08 nothing tested
 * the pair — every table test compared backend strings to other backend strings.
 *
 * The gap shipped in 0.3.0. `kubectl get svc` in Snapshot mode put CLUSTER-IP
 * inside the TYPE cell and shifted every later column left, because the backend
 * emitted `LoadBalancer10.96.155.77` (TYPE is 12 wide, `LoadBalancer` is 12
 * characters) and the frontend splits on `/\s{2,}/`. 190 backend tests were
 * green throughout, and so was the one-space fix that followed, which still left
 * the two values in one cell.
 *
 * So this drives the real frontend service with the real backend renderer over
 * every kind the config declares. It runs under node:test rather than Karma
 * because the backend half lives in api/ — OutputParserService has no injected
 * dependencies, so `new` is enough.
 */

const parser = new OutputParserService();
const FIXTURE = path.join(PKG_ROOT, 'test-fixtures', 'table-items.json');
const items: Record<string, Record<string, unknown>> = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('a rendered table survives the trip back through the frontend parser', () => {
  for (const [kind, spec] of Object.entries(loadTables())) {
    it(`${kind}: every column arrives in its own cell`, () => {
      const item = items[kind];
      assert.ok(item, `no fixture for ${kind} — run: node scripts/capture-table-fixtures.js`);

      const text = renderTable(spec, [item as never]);
      const parsed = parser.parseCommandOutput(text, `kubectl get ${kind.toLowerCase()}`);

      assert.equal(parsed.type, 'table', `parsed as ${parsed.type}, not a table:\n${text}`);
      assert.deepEqual(
        parsed.headers,
        spec.columns.map((c) => c.name),
        `header split does not match the config's columns:\n${text}`,
      );

      // The failure mode this exists for: a row with fewer cells than headers,
      // because two values ran together. Compare per row, not just the header —
      // the header line is padded from short names and rarely overflows.
      const row = text.split('\n')[1];
      assert.equal(
        row.split(/\s{2,}/).length,
        spec.columns.length,
        `row split into ${row.split(/\s{2,}/).length} cells for ${spec.columns.length} columns:\n` +
          `  ${JSON.stringify(row)}\n  ${JSON.stringify(row.split(/\s{2,}/))}`,
      );
    });
  }
});
