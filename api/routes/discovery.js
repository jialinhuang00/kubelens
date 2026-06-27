const express = require('express');
const { execFile } = require('child_process');
const util = require('util');
const { getDiscoveryExclude } = require('../utils/config-loader');
const { parseApiResources } = require('../utils/api-resources');

const execFileAsync = util.promisify(execFile);

const router = express.Router();

// Parse the table, then drop the curated noise groups/resources from config.
function parseAndFilter(stdout) {
  const { groups, resources } = getDiscoveryExclude();
  const exGroups = new Set(groups);
  const exResources = new Set(resources);
  return parseApiResources(stdout).filter(r => !exGroups.has(r.group) && !exResources.has(r.name));
}

// GET /api/api-resources — namespaced kinds the cluster actually has, for the
// visibility panel. `kubectl api-resources` has no JSON output, so parse the table.
// Broken APIServices (e.g. a down metrics adapter) make kubectl exit non-zero but
// it still lists the working resources on stdout — salvage those.
router.get('/api-resources', async (req, res) => {
  try {
    const { stdout } = await execFileAsync(
      'kubectl', ['api-resources', '--verbs=list', '--namespaced=true'],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    res.json({ resources: parseAndFilter(stdout) });
  } catch (e) {
    if (e.stdout) {
      res.json({ resources: parseAndFilter(e.stdout), warning: (e.stderr || '').trim() });
    } else {
      res.json({ resources: [], error: (e.stderr || '').trim() || e.message });
    }
  }
});

module.exports = router;
