import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Which cluster kubectl is pointed at right now.
 *
 * Exported as a mutable object rather than a bare function so tests can replace
 * the implementation. The alternative — letting the real binary run — makes the
 * result depend on whoever's kubeconfig is on the machine, which is both
 * unassertable and a unit test reaching outside the repo. The seam is here
 * rather than an env var so it exists only for callers that can see this file.
 */
export const kubectlContext = {
  async current(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('kubectl', ['config', 'current-context'], { timeout: 3000 });
      return stdout.trim() || null;
    } catch {
      return null; // no kubectl, no kubeconfig, or no context selected
    }
  },
};
