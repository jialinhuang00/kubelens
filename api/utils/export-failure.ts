/**
 * What to show the user when an export exits non-zero.
 *
 * The exporters already explain themselves. Refusing a cross-cluster resume
 * prints three lines naming both clusters and three ways forward — but on
 * stderr, and the only thing the UI renders is the `error` string. So the panel
 * used to say "Export failed: Process exited with code 1" while the sentence
 * that would have told you what to do sat in the server's terminal.
 *
 * Lives here rather than inline in the route so it can be tested without
 * spawning a child process.
 */

/** Lines that describe the machinery rather than the failure. */
const NOISE = [
  /^\s*$/,
  /^\s*at\s/,             // stack frames
  /^\s*\.\.\.\s/,         // truncated frame lists
  /^node:internal\//,
  /^Node\.js v/,
];

const MAX_LINES = 6;
const MAX_CHARS = 600;

/** Strip ANSI colour so the browser shows text rather than escape codes. */
function plain(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function exportFailureMessage(exitCode: number | null, stderr: string): string {
  const fallback = `Process exited with code ${exitCode}`;
  if (!stderr) return fallback;

  const lines = plain(stderr)
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => !NOISE.some(re => re.test(l)));

  if (lines.length === 0) return fallback;

  // The last lines are the ones about this failure; anything earlier is progress
  // output from namespaces that succeeded before it.
  const tail = lines.slice(-MAX_LINES).join('\n');
  const trimmed = tail.length > MAX_CHARS ? `…${tail.slice(-MAX_CHARS)}` : tail;
  return `${fallback}\n${trimmed}`;
}
