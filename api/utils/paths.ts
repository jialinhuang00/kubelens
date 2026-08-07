/**
 * Two roots, two different questions.
 *
 * PKG_ROOT  — where kubelens's own files live: scripts/, kubelens.default.yaml.
 *             Always relative to this file, so it follows the install location.
 * userRoot() — where the user's files live: kubelens.config.yaml, k8s-snapshot/.
 *             The directory the server is running from.
 *
 * Running from a clone (`pnpm run dev` at the repo root) the two are the same
 * directory, which is why this distinction never mattered before. Installed
 * from npm they are not: PKG_ROOT is inside node_modules (or the npx cache),
 * and writing a snapshot there means it disappears on the next version bump.
 */
import * as path from 'path';
import * as fs from 'fs';

export const PKG_ROOT: string = path.join(__dirname, '..', '..');

/**
 * A function, not a constant read at import time. The server never changes its
 * working directory, so both forms behave the same in production — but a module
 * that froze the value at import forced every test to load it late, after the
 * chdir into a temp directory. `api/routes/snapshot.spec.ts` had to `require`
 * the route inside `before()` for exactly that reason, which is how the route
 * and the spec ended up resolving a shared dependency to two different files.
 */
export function userRoot(): string {
  return process.cwd();
}

/**
 * Where to READ a config/data entry from: the working directory, falling back to
 * PKG_ROOT when it only exists there. The fallback covers two real cases: a
 * server started from a subdirectory of the clone, and a pm2 process whose cwd
 * is not the project root.
 *
 * Read-only, and the name says so. Deleting or writing through this is how a
 * missing user directory turns into damage somewhere else: the moment
 * `<cwd>/k8s-snapshot` stops existing, this starts returning the package's own
 * copy, and the next `rm -rf` lands there. Under npm that is inside
 * node_modules; in this repo it is the developer's real export. It happened
 * three times in one afternoon before the two paths were separated.
 */
export function resolveDataPath(name: string): string {
  const userPath = path.join(userRoot(), name);
  if (fs.existsSync(userPath)) return userPath;
  const pkgPath = path.join(PKG_ROOT, name);
  if (fs.existsSync(pkgPath)) return pkgPath;
  return userPath;
}

/**
 * Where to WRITE a data entry: always the working directory, whether or not it
 * exists yet. No fallback — a caller that creates, overwrites or deletes must
 * never be handed the package's own files.
 */
export function userDataPath(name: string): string {
  return path.join(userRoot(), name);
}
