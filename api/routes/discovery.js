const express = require('express');
const { execFile } = require('child_process');
const util = require('util');
const { getDiscoveryExclude } = require('../utils/config-loader');

const execFileAsync = util.promisify(execFile);

const router = express.Router();

// Parse `kubectl api-resources` table output. Columns: NAME [SHORTNAMES]
// APIVERSION NAMESPACED KIND. SHORTNAMES is optional, so parse right-anchored.
function parseApiResources(stdout) {
  const out = [];
  const lines = stdout.split('\n').slice(1); // drop header
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
  const { groups, resources } = getDiscoveryExclude();
  const exGroups = new Set(groups);
  const exResources = new Set(resources);
  return out.filter(r => !exGroups.has(r.group) && !exResources.has(r.name));
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
    res.json({ resources: parseApiResources(stdout) });
  } catch (e) {
    if (e.stdout) {
      res.json({ resources: parseApiResources(e.stdout), warning: (e.stderr || '').trim() });
    } else {
      res.json({ resources: [], error: (e.stderr || '').trim() || e.message });
    }
  }
});

module.exports = router;
