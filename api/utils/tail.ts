/**
 * Keeps the last `limit` units of a growing string without cutting a character
 * in half.
 *
 * The export panel shows the tail of the exporter's stderr, and that text
 * carries the kubectl context — a name the user chose, so it can be Chinese, or
 * an emoji. A blind `.slice(-limit)` can land inside one of those and put half a
 * character on screen.
 *
 * JavaScript strings are UTF-16 code units. A CJK character is one unit and
 * survives any cut; an emoji is a surrogate pair, and cutting between the two
 * halves leaves an orphan that renders as a replacement glyph. So this only has
 * to check one thing: whether the first kept unit is a low surrogate.
 *
 * The Go half of this is `tailBytes` in cmd/server/routes/k8s_export.go, and it
 * has more to guard: Go strings are bytes, so a CJK character is three of them
 * and any of the two interior positions is a bad cut.
 */

/** true for the second half of a surrogate pair (U+DC00–U+DFFF). */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function tailChars(s: string, limit: number): string {
  if (s.length <= limit) return s;
  let start = s.length - limit;
  // Drop the orphaned half. At most one unit, so the cap still holds.
  if (isLowSurrogate(s.charCodeAt(start))) start++;
  return s.slice(start);
}
