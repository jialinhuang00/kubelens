import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDiscoveryExclude } from '../utils/config-loader';
import { parseApiResources } from '../utils/api-resources';

const execFileAsync = promisify(execFile);

const router = express.Router();

/** A failed execFile carries the child's output on the error object. */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

// Parse the table, then drop the curated noise groups/resources from config.
function parseAndFilter(stdout: string) {
  const { groups, resources } = getDiscoveryExclude();
  const exGroups = new Set(groups);
  const exResources = new Set(resources);
  return parseApiResources(stdout).filter(r => !exGroups.has(r.group) && !exResources.has(r.name));
}

// GET /api/api-resources — namespaced kinds the cluster actually has, for the
// visibility panel. `kubectl api-resources` has no JSON output, so parse the table.
// Broken APIServices (e.g. a down metrics adapter) make kubectl exit non-zero but
// it still lists the working resources on stdout — salvage those.
router.get('/api-resources', async (req: Request, res: Response) => {
  try {
    const { stdout } = await execFileAsync(
      'kubectl', ['api-resources', '--verbs=list', '--namespaced=true'],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    res.json({ resources: parseAndFilter(stdout) });
  } catch (err) {
    const e = err as ExecError;
    if (e.stdout) {
      res.json({ resources: parseAndFilter(e.stdout), warning: (e.stderr || '').trim() });
    } else {
      res.json({ resources: [], error: (e.stderr || '').trim() || e.message });
    }
  }
});

export = router;
