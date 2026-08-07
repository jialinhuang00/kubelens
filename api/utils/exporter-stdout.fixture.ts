import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './paths';

/**
 * Real stdout from each exporter, captured by scripts/capture-exporter-output.sh
 * against a live cluster and committed under test-fixtures/exporter-stdout/.
 *
 * Both backends read these same files (Go: cmd/server/routes/exporter_stdout_test.go),
 * so the two hand-written parsers are checked against one shared sample instead
 * of against a sample each. `npm run test:parity` re-runs the capture and fails
 * if the exporters no longer print what is committed here.
 */

export const EXPORTER_MODES = ['bash', 'node', 'workers', 'procs', 'go'] as const;
export type ExporterMode = (typeof EXPORTER_MODES)[number];

export const FIXTURE_DIR = path.join(PKG_ROOT, 'test-fixtures', 'exporter-stdout');

export function exporterStdout(mode: ExporterMode | string): string {
  const file = path.join(FIXTURE_DIR, `${mode}.txt`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `no captured output for the '${mode}' exporter.\n` +
        `Run: bash scripts/capture-exporter-output.sh   (needs a cluster and a Go toolchain)`,
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/** Both routes strip colour before parsing; the fixtures keep it, as the exporters print it. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
