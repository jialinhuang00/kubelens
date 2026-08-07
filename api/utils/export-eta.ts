/**
 * ETA for a running export, clamped so it only ever counts down.
 *
 * The raw estimate is elapsed / finished * remaining, which jumps around: one
 * slow namespace early on projects a wildly high total, and the number would
 * climb back up as later namespaces come in fast. Users read a rising ETA as
 * the export going backwards, so the reported value is the smallest estimate
 * seen so far and the running minimum is carried between polls.
 *
 * Lives here rather than inline in the route so it can be tested without
 * spawning an exporter — the route can only reach this code path with a live
 * child process writing progress lines.
 */

export interface EtaInput {
  /** Smallest estimate seen so far this run; null on the first poll. */
  minEtaSeconds: number | null | undefined;
  /** Seconds since the export started. */
  elapsedSeconds: number;
  doneNamespaces: number;
  totalNamespaces: number;
}

export interface EtaResult {
  /** What to report, or null when there is not enough data yet. */
  etaSeconds: number | null;
  /** The new running minimum, to carry into the next poll. */
  minEtaSeconds: number | null;
}

export function nextEta(input: EtaInput): EtaResult {
  const { elapsedSeconds, doneNamespaces, totalNamespaces } = input;
  // `== null` on purpose: it catches undefined as well as null. Reading this as
  // `=== null` is what broke the second export of every server session — the
  // START handler rebuilt its state object without minEtaSeconds, so the value
  // arrived as undefined, `undefined === null` was false, `raw < undefined` was
  // also false, and the running minimum was never assigned. etaSeconds came out
  // undefined, JSON.stringify dropped the key, and the ETA silently vanished.
  const min = input.minEtaSeconds == null ? null : input.minEtaSeconds;

  if (doneNamespaces <= 0 || totalNamespaces <= 0) {
    return { etaSeconds: min, minEtaSeconds: min };
  }

  const avgPerNs = elapsedSeconds / doneNamespaces;
  const remaining = totalNamespaces - doneNamespaces;
  const raw = Math.round(avgPerNs * remaining);

  const next = min === null || raw < min ? raw : min;
  return { etaSeconds: next, minEtaSeconds: next };
}
