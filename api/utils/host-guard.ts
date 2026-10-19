/**
 * DNS rebinding guard.
 *
 * A page on evil.example can point its own DNS name at 127.0.0.1. The browser
 * then treats requests to evil.example:3042 as same-origin, so the Origin check
 * passes, and kubelens on loopback runs whatever the page sends. The one thing
 * the page cannot change is the Host header: it still says evil.example. So
 * every request, REST and WebSocket alike, must name a host kubelens expects.
 */

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const WILDCARD = new Set(['0.0.0.0', '::', '[::]']);

export interface HostPolicy {
  allowed: Set<string>;
  /** Bound to every interface with no allowlist: the check is off (see hostPolicy). */
  open: boolean;
}

export function hostPolicy(env: NodeJS.ProcessEnv = process.env): HostPolicy {
  const bind = (env['HOST'] || '127.0.0.1').toLowerCase();
  const extra = (env['KUBELENS_ALLOWED_HOSTS'] || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([...LOOPBACK, ...extra]);
  if (!WILDCARD.has(bind)) allowed.add(bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind);
  // Someone who binds 0.0.0.0 wants to be reached by whatever name points at the
  // machine (an EC2 public IP, say). Without a list there is no way to know those
  // names, so the check stays off rather than lock out an existing deploy; the
  // server warns at startup and KUBELENS_ALLOWED_HOSTS turns it back on.
  return { allowed, open: WILDCARD.has(bind) && extra.length === 0 };
}

/** "localhost:3042" -> "localhost", "[::1]:3042" -> "[::1]"; null when unparseable. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostAllowed(hostHeader: string | undefined, policy: HostPolicy): boolean {
  if (policy.open) return true;
  const name = hostnameOf(hostHeader);
  return name !== null && policy.allowed.has(name);
}
