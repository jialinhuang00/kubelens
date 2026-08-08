import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PKG_ROOT } from './paths';
import { loadTables } from './config-loader';
import { handleCommand } from './snapshot-handler';
import { OutputParserService } from '../../src/app/features/dashboard/services/output-parser.service';

/**
 * OutputParserService decides what a command's output *is* — table, multiple
 * tables, YAML, or raw. Misrouting is the quiet failure: `kubectl describe`
 * rendered as a table, or a real table falling through to raw text, both look
 * like the app is working.
 *
 * `.itest.ts` because these drive real commands against the snapshot on disk,
 * and `test:utils` deliberately points K8S_SNAPSHOT_PATH at nothing. Skipped
 * rather than faked when no snapshot is there — a fabricated one would test the
 * fixture, not the reader.
 */

const parser = new OutputParserService();
const parse = (out: string, cmd = '') => parser.parseCommandOutput(out, cmd);
const SNAP = process.env.K8S_SNAPSHOT_PATH || path.join(PKG_ROOT, 'k8s-snapshot');
const haveSnapshot = fs.existsSync(path.join(SNAP, 'demo'));

describe('OutputParserService routes real command output to the right shape', () => {
  if (!haveSnapshot) {
    it('skipped: no k8s-snapshot/demo to read', { skip: true }, () => {});
    return;
  }

  it('reads a real rendered table as a table', () => {
    const out = handleCommand('kubectl get services -n demo');
    const r = parse(out.stdout ?? '', 'kubectl get services -n demo');
    assert.equal(r.type, 'table');
    assert.deepEqual(r.headers, loadTables()['Service'].columns.map(c => c.name));
  });

  it('reads `kubectl get all` as multiple tables, one per section', () => {
    const out = handleCommand('kubectl get all -n demo');
    const r = parse(out.stdout ?? '', 'kubectl get all -n demo');
    assert.equal(r.type, 'multiple-tables');
    assert.ok((r.tables?.length ?? 0) >= 2, `only ${r.tables?.length} table(s)`);
  });

  it('reads describe output as yaml, not as a table', () => {
    // describe is key: value lines, which look tabular if you squint. Routing it
    // to the table branch would drop every line with no second column.
    const out = handleCommand('kubectl describe service gateway -n demo');
    const r = parse(out.stdout ?? '', 'kubectl describe service gateway -n demo');
    assert.notEqual(r.type, 'table', `describe was parsed as a table:\n${out.stdout?.slice(0, 200)}`);
  });

  it('reads `-o yaml` as yaml, not as a table', () => {
    const out = handleCommand('kubectl get service gateway -n demo -o yaml');
    const r = parse(out.stdout ?? '', 'kubectl get service gateway -n demo -o yaml');
    assert.ok(['yaml', 'multiple-yamls', 'raw'].includes(r.type), `got ${r.type}`);
  });

  it('reads `-o name` as raw lines, not as a headerless table', () => {
    const out = handleCommand('kubectl get services -n demo -o name');
    const r = parse(out.stdout ?? '', 'kubectl get services -n demo -o name');
    assert.notEqual(r.type, 'table', 'a list of names has no header row to take');
  });
});
