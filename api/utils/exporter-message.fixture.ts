import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './paths';

/**
 * Reproduces what `scripts/snapshot-bash.sh` prints, by reading the script.
 *
 * The two backends each had a hand-typed copy of the cross-cluster abort
 * message. When the script started naming K8S_SNAPSHOT_PATH instead of
 * K8S_SNAPSHOT_DIR, both copies kept the old name and every test stayed green:
 * a copied fixture can only catch the formatter losing something it already
 * handled, never the exporter changing what it says. The Go side reads the same
 * lines out of the same file (cmd/server/routes/export_failure_test.go).
 *
 * This resolves the script through PKG_ROOT, so it reads the repo's own copy
 * regardless of where the test process was started from.
 */

const SCRIPT = path.join(PKG_ROOT, 'scripts', 'snapshot-bash.sh');

/** Turns bash's `$'...'` escapes into the bytes printf would emit. */
function unescape(s: string): string {
  return s
    .replace(/\\033/g, '\x1b')
    .replace(/\\e/g, '\x1b')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

/** `RED='\033[31m'` → the escape sequence itself. */
function shellConstants(script: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of script.matchAll(/^([A-Z_]+)='([^']*)'$/gm)) {
    out[name] = unescape(value);
  }
  return out;
}

/** Joins backslash continuations, drops comments and blank lines. */
function statements(lines: string[]): string[] {
  const joined: string[] = [];
  let pending = '';
  for (const line of lines) {
    const body = line.trim();
    if (body.startsWith('#') || body === '') continue;
    if (body.endsWith('\\')) {
      pending += body.slice(0, -1);
      continue;
    }
    joined.push((pending + body).trim());
    pending = '';
  }
  if (pending) joined.push(pending.trim());
  return joined;
}

/**
 * Extracts the block between `# fixture:<name>:start` / `:end` and renders every
 * `printf` in it, substituting `%s` with the caller's values by variable name.
 *
 * Throws when the markers are missing or when a `%s` has no value: a fixture
 * that silently renders half the message is worse than one that fails loudly.
 */
export function exporterMessage(name: string, values: Record<string, string>): string {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  const consts = shellConstants(script);

  const start = script.indexOf(`# fixture:${name}:start`);
  const end = script.indexOf(`# fixture:${name}:end`);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${SCRIPT} has no '# fixture:${name}:start/:end' block`);
  }
  const block = script.slice(start, end).split('\n').slice(1);

  let out = '';
  for (const statement of statements(block)) {
    const printf = /^printf\s+"((?:[^"\\]|\\.)*)"\s*(.*)$/.exec(statement);
    if (!printf) continue;

    const args = [...printf[2].matchAll(/"\$([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]);
    let text = unescape(printf[1].replace(/\$\{([A-Z_]+)\}/g, (whole, key) => consts[key] ?? whole));

    let arg = 0;
    out += text.replace(/%s/g, () => {
      const variable = args[arg++];
      if (variable === undefined) throw new Error(`fixture ${name}: more %s than arguments`);
      const value = values[variable];
      if (value === undefined) throw new Error(`fixture ${name}: no value given for $${variable}`);
      return value;
    });
  }

  if (out === '') throw new Error(`fixture ${name}: block has no printf lines`);
  return out;
}
