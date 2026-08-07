import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportFailureMessage } from './export-failure';

// What snapshot-bash.sh prints when it refuses to mix two clusters, colour and
// all. This is the message the panel used to swallow.
const CROSS_CLUSTER = `
\x1b[31mERROR: k8s-snapshot holds a snapshot of arn:aws:eks:ap-northeast-1:000000000000:cluster/prod, and kubectl is on kind-kubelens-demo.\x1b[0m
Adding namespaces from a second cluster would leave both in one directory.
Nothing was changed. Switch context back to arn:aws:eks:ap-northeast-1:000000000000:cluster/prod to continue this snapshot,
run a full export to replace it, or set K8S_SNAPSHOT_DIR to a different path.
`;

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
