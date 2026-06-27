/**
 * Parser for `kubectl api-resources` table output. There's no JSON output mode,
 * so we parse the table. Columns: NAME [SHORTNAMES] APIVERSION NAMESPACED KIND.
 * SHORTNAMES is optional, so parse right-anchored (kind last, apiVersion last-2).
 *
 * Shared by the /api/api-resources route and the `kubelens init` script.
 */

export interface ApiResource {
  name: string;         // bare plural, e.g. "virtualservices"
  kind: string;         // Kind, e.g. "VirtualService"
  group: string;        // API group ('' = core)
  resourceType: string; // kubectl target, e.g. "virtualservices.networking.istio.io"
}

/** Parse api-resources table text. `hasHeader` drops the first line (kubectl
 *  prints a header unless --no-headers is passed). */
export function parseApiResources(stdout: string, hasHeader = true): ApiResource[] {
  const out: ApiResource[] = [];
  const lines = hasHeader ? stdout.split('\n').slice(1) : stdout.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 4) continue;
    const name = cols[0];
    const kind = cols[cols.length - 1];
    const apiVersion = cols[cols.length - 3];
    const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
    const resourceType = group ? `${name}.${group}` : name;
    out.push({ name, kind, group, resourceType });
  }
  return out;
}
