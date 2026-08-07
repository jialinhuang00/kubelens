import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PKG_ROOT } from './paths';

/**
 * Where `k8s-snapshot` lives is decided three times over — once in TypeScript,
 * once in Go, and once per exporter — and the three cannot be compared by
 * reading them. Every round of drift so far has been invisible in exactly that
 * gap: an export that writes one directory while the app counts another does
 * not crash, it just never updates.
 *
 * So this asks each implementation, in its own language, for the directory it
 * would use, and compares the answers. The exporters print theirs as
 * `Export target:` during preflight; that line is the closest thing they have to
 * a public accessor.
 *
 * `.itest.ts`, not `.spec.ts`, and run by `npm run test:parity` rather than
 * `test:utils`. Running an exporter for real means running kubectl, and the unit
 * specs are supposed to make zero external calls — a rule worth keeping
 * measurable rather than quietly relaxing for this one file.
 *
 * Skipped where the tools cannot run rather than faked: bash needs a reachable
 * cluster to get past its preflight, and the Go answer needs a Go toolchain. A
 * skip says "not measured here", which is the honest result on a machine that
 * cannot run them.
 */

/**
 * On PATH *and* able to run. `which` alone is not enough: a wrapper script that
 * resolves but cannot exec looks installed and fails at the first call, which
 * reads as a failing assertion rather than a missing tool.
 */
function usable(binary: string, probeArgs: string[]): boolean {
  try {
    execFileSync(binary, probeArgs, { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** The directory `snapshotDir()` resolves to, asked in a clean child process. */
function appAnswer(cwd: string, env: NodeJS.ProcessEnv): string {
  const out = execFileSync(process.execPath, [
    '-e',
    `const {snapshotDir} = require(${JSON.stringify(path.join(PKG_ROOT, 'api', 'utils', 'paths.js'))});` +
    'process.stdout.write(snapshotDir());',
  ], { cwd, env, encoding: 'utf8' });
  return out.trim();
}

/** What an exporter prints as its target, without letting it reach a cluster. */
function exporterAnswer(argv: string[], cwd: string, env: NodeJS.ProcessEnv): string | null {
  let out = '';
  try {
    out = execFileSync(argv[0], argv.slice(1), {
      cwd, env, encoding: 'utf8', timeout: 60_000, stdio: 'pipe',
    });
  } catch (err) {
    // A missing cluster fails after the preflight has printed. Read what it did
    // print rather than treating the exit code as the whole answer.
    out = String((err as { stdout?: string }).stdout ?? '');
  }
  const line = out.split('\n').find(l => l.includes('Export target:'));
  return line ? line.split('Export target:')[1].trim() : null;
}

describe('snapshot directory parity across implementations', () => {
  const cases: Array<{ name: string; env: Record<string, string> }> = [
    { name: 'K8S_SNAPSHOT_PATH only', env: { K8S_SNAPSHOT_PATH: '' } },
    { name: 'K8S_SNAPSHOT_DIR only', env: { K8S_SNAPSHOT_DIR: '' } },
    { name: 'both set, pointing at different directories', env: { K8S_SNAPSHOT_PATH: '', K8S_SNAPSHOT_DIR: '' } },
  ];

  for (const c of cases) {
    it(`bash exporter and the app agree: ${c.name}`, (t) => {
      if (!usable('kubectl', ['config', 'current-context'])) {
        return t.skip('kubectl cannot reach a cluster — the bash preflight stops before it prints');
      }

      const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-parity-')));
      try {
        // Fill the placeholders: PATH gets /a, DIR gets /b, so a wrong
        // precedence shows up as a different letter rather than a near-miss.
        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.K8S_SNAPSHOT_PATH;
        delete env.K8S_SNAPSHOT_DIR;
        if ('K8S_SNAPSHOT_PATH' in c.env) env.K8S_SNAPSHOT_PATH = path.join(tmp, 'a');
        if ('K8S_SNAPSHOT_DIR' in c.env) env.K8S_SNAPSHOT_DIR = path.join(tmp, 'b');

        const app = appAnswer(tmp, env);
        const exporter = exporterAnswer(
          ['bash', path.join(PKG_ROOT, 'scripts', 'snapshot-bash.sh'), '-n', 'kubelens-parity-probe'],
          tmp, env,
        );

        assert.ok(exporter, 'the bash exporter never printed an Export target line');
        assert.equal(exporter, app,
          `the app resolves ${app} and the bash exporter targets ${exporter}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it('the Go loader agrees with the app', (t) => {
    if (!usable('go', ['version'])) return t.skip('no Go toolchain');

    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-parity-go-')));
    const probeDir = path.join(PKG_ROOT, 'cmd', 'server', 'cmd', 'snapshotdir-probe');
    try {
      fs.mkdirSync(probeDir, { recursive: true });
      fs.writeFileSync(path.join(probeDir, 'main.go'),
        'package main\n\nimport (\n\t"fmt"\n\n\t"kubelens/server/store"\n)\n\n' +
        'func main() { fmt.Print(store.SnapshotDir()) }\n');

      const env: NodeJS.ProcessEnv = { ...process.env };
      env.K8S_SNAPSHOT_PATH = path.join(tmp, 'a');
      env.K8S_SNAPSHOT_DIR = path.join(tmp, 'b');

      const goAnswer = execFileSync('go', ['-C', path.join(PKG_ROOT, 'cmd', 'server'), 'run', './cmd/snapshotdir-probe'],
        { cwd: tmp, env, encoding: 'utf8', timeout: 120_000 }).trim();

      assert.equal(goAnswer, appAnswer(tmp, env));
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
