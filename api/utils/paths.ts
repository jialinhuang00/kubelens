/**
 * Two roots, two different questions.
 *
 * PKG_ROOT  — where kubelens's own files live: scripts/, kubelens.default.yaml.
 *             Always relative to this file, so it follows the install location.
 * USER_ROOT — where the user's files live: kubelens.config.yaml, k8s-snapshot/.
 *             The directory the server was started from.
 *
 * Running from a clone (`pnpm run dev` at the repo root) the two are the same
 * directory, which is why this distinction never mattered before. Installed
 * from npm they are not: PKG_ROOT is inside node_modules (or the npx cache),
 * and writing a snapshot there means it disappears on the next version bump.
 */
import * as path from 'path';
import * as fs from 'fs';

export const PKG_ROOT: string = path.join(__dirname, '..', '..');

export const USER_ROOT: string = process.env.KUBELENS_HOME || process.cwd();

/**
 * Resolve a config/data entry against USER_ROOT, falling back to PKG_ROOT when
 * it only exists there. The fallback covers two real cases: a server started
 * from a subdirectory of the clone, and a pm2 process whose cwd is not the
 * project root. A fresh path that exists in neither resolves to USER_ROOT, so
 * anything created later lands in the user's directory.
 */
export function resolveDataPath(name: string): string {
  const userPath = path.join(USER_ROOT, name);
  if (fs.existsSync(userPath)) return userPath;
  const pkgPath = path.join(PKG_ROOT, name);
  if (fs.existsSync(pkgPath)) return pkgPath;
  return userPath;
}
