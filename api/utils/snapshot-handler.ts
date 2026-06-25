/**
 * K8s snapshot handler — re-export shim.
 * Delegates command handling to snapshot-commands.
 *
 * Public API (unchanged):
 *   handleCommand(command) → { success, stdout?, error? }
 *   parseKubectlCommand(command) → parsed object
 */

import { handleCommand, parseKubectlCommand } from './snapshot-commands';
import type { CommandResult, ParsedCommand } from './snapshot-commands';

export { handleCommand, parseKubectlCommand };
export type { CommandResult, ParsedCommand };
