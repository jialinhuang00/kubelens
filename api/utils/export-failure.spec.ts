import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportFailureMessage } from './export-failure';
import { exporterMessage } from './exporter-message.fixture';
import { snapshotDir } from './paths';

const PROD = 'arn:aws:eks:ap-northeast-1:000000000000:cluster/prod';

// What snapshot-bash.sh prints when it refuses to mix two clusters, colour and
// all. This is the message the panel used to swallow. Read out of the script
// rather than copied: the copy went stale the moment the script changed which
// environment variable it names, and nothing here went red. See
// exporter-message.fixture.ts.
const CROSS_CLUSTER = exporterMessage('cross-cluster-abort', {
  BASE_DIR: 'k8s-snapshot',
  RECORDED: PROD,
  CONTEXT: 'kind-kubelens-demo',
});

describe('exportFailureMessage', () => {
  it('carries the reason the exporter gave, not just the exit code', () => {
    const msg = exportFailureMessage(1, CROSS_CLUSTER);
    assert.match(msg, /Process exited with code 1/);
    assert.match(msg, /holds a snapshot of arn:aws:eks:.*cluster\/prod/);
    assert.match(msg, /kubectl is on kind-kubelens-demo/);
    assert.match(msg, /Nothing was changed/);
  });

  it('strips ANSI colour so the browser shows text, not escape codes', () => {
    assert.doesNotMatch(exportFailureMessage(1, CROSS_CLUSTER), /\x1b\[/);
  });

  it('falls back to the exit code when stderr is empty', () => {
    assert.equal(exportFailureMessage(1, ''), 'Process exited with code 1');
  });

  it('falls back when stderr held nothing but blank lines', () => {
    assert.equal(exportFailureMessage(2, '\n\n   \n'), 'Process exited with code 2');
  });

  it('drops node stack frames, which say nothing about the failure', () => {
    const crash = [
      'Error: connect ECONNREFUSED 127.0.0.1:6443',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      'Node.js v22.22.3',
    ].join('\n');
    const msg = exportFailureMessage(1, crash);
    assert.match(msg, /ECONNREFUSED/);
    assert.doesNotMatch(msg, /TCPConnectWrap/);
    assert.doesNotMatch(msg, /Node\.js v/);
  });

  it('keeps the end, where the failure is, not the start', () => {
    const noisy = Array.from({ length: 40 }, (_, i) => `namespace-${i} warning`).join('\n')
      + '\nERROR: the one line that matters';
    const msg = exportFailureMessage(1, noisy);
    assert.match(msg, /the one line that matters/);
    assert.doesNotMatch(msg, /namespace-0 warning/);
  });

  it('caps the length so one runaway line cannot fill the panel', () => {
    const msg = exportFailureMessage(1, 'x'.repeat(50_000));
    assert.ok(msg.length < 800, `message was ${msg.length} chars`);
  });
});

// The abort message tells the user which environment variable to set. Both ends
// of that sentence are read from source here — the names out of the script, the
// behaviour out of snapshotDir() — so renaming the variable in one place and not
// the other fails instead of shipping advice that does nothing. The same check
// exists in Go (cmd/server/routes/export_failure_test.go).
describe('the variable the abort message names', () => {
  it('is one the app actually honours', () => {
    const named = [...new Set(CROSS_CLUSTER.match(/K8S_[A-Z_]+/g) ?? [])];
    assert.ok(named.length > 0, 'the abort message names no environment variable at all');

    const saved = { ...process.env };
    try {
      for (const name of named) {
        delete process.env.K8S_SNAPSHOT_PATH;
        delete process.env.K8S_SNAPSHOT_DIR;
        process.env[name] = '/tmp/kubelens-abort-advice';
        assert.equal(
          snapshotDir(),
          '/tmp/kubelens-abort-advice',
          `snapshot-bash.sh tells the user to set ${name}, but snapshotDir() ignores it`,
        );
      }
    } finally {
      process.env = saved;
    }
  });
});
