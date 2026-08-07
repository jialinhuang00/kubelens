/**
 * Turns an exporter's stdout into progress state.
 *
 * The five exporters agree on a line format that nothing enforces, and both
 * backends read it with their own hand-written regexes. Both were wrong: the
 * bash exporter padded its namespace tag inside the brackets, so this parser
 * matched four exporters of five, and the Go route's patterns had no tag at all
 * and matched none. The panel showed no "writing..." line and, on `dev:go`, no
 * current namespace either.
 *
 * Lives here rather than inside the route handler so a test can drive the real
 * patterns against real captured output (export-progress.spec.ts). The Go port
 * is applyProgressChunk in cmd/server/routes/k8s_export.go, tested against the
 * same captured files.
 */

export interface ProgressState {
  totalNamespaces: number;
  completedNamespaces: number;
  // Optional because the route's ExportState carries `boolean | undefined`.
  // Only ever written here, never read.
  freshStart?: boolean;
  activeNamespaces: Set<string>;
  activeResources: Set<string>;
}

export function emptyProgressState(): ProgressState {
  return {
    totalNamespaces: 0,
    completedNamespaces: 0,
    freshStart: true,
    activeNamespaces: new Set(),
    activeResources: new Set(),
  };
}

/**
 * The namespace tag every exporter prefixes its per-resource lines with:
 * "[demo]" followed by padding. Written once here because getting it wrong is
 * invisible — a tag that does not match costs a line in the panel, not an error.
 */
const NS_TAG = String.raw`(?:\[\S+\]\s+)?`;

export const PROGRESS_PATTERNS = {
  discovered: /Discovered (\d+) namespaces/,
  skipped: /=== Namespace: (.+?) === \(complete, skipping\)/g,
  nsStart: /^(\S+) start$/gm,
  nsDone: /✓ Namespace (\S+) completed/g,
  fetching: new RegExp(`→ ${NS_TAG}fetching (\\S+)`, 'gm'),
  resourceDone: new RegExp(`← ${NS_TAG}(\\S+) (?:done|failed)`, 'gm'),
};

/** Applies one chunk of stdout. Chunks arrive split at arbitrary byte offsets. */
export function applyProgressChunk(state: ProgressState, text: string): void {
  const discovered = text.match(PROGRESS_PATTERNS.discovered);
  if (discovered) {
    state.totalNamespaces = parseInt(discovered[1], 10);
    state.freshStart = false; // the exporter is rewriting the directory now
  }

  const skippedSet = new Set<string>();
  for (const m of text.matchAll(PROGRESS_PATTERNS.skipped)) {
    state.completedNamespaces++;
    skippedSet.add(m[1]);
  }

  for (const m of text.matchAll(PROGRESS_PATTERNS.nsStart)) {
    if (!skippedSet.has(m[1])) state.activeNamespaces.add(m[1]);
  }

  for (const m of text.matchAll(PROGRESS_PATTERNS.nsDone)) {
    state.activeNamespaces.delete(m[1]);
  }

  for (const m of text.matchAll(PROGRESS_PATTERNS.fetching)) {
    for (const r of m[1].split(',')) state.activeResources.add(r);
  }

  for (const m of text.matchAll(PROGRESS_PATTERNS.resourceDone)) {
    for (const r of m[1].split(',')) state.activeResources.delete(r);
  }
}
