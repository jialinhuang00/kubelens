const express = require('express');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const router = express.Router();

// Number of most-recent tags to return.
const RECENT = 20;

// ECR_PROFILE_MAP: maps AWS account ID → AWS SSO profile name (JSON)
// e.g. {"123456789012":"PowerUserAccess-123456789012"}
const ECR_PROFILE_MAP = (() => {
  try {
    return JSON.parse(process.env.ECR_PROFILE_MAP || '{}');
  } catch {
    return {};
  }
})();

// CLI binary each registry type shells out to — used for the "not installed" hint.
const CLI = { ecr: 'aws', gar: 'gcloud', gcr: 'gcloud', acr: 'az' };

/**
 * Classify an image URL by its registry host and pull out the parts each
 * fetcher needs. Returns null for hosts we don't support.
 */
function parseRegistry(image) {
  let m;
  // AWS ECR:  <account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>
  if ((m = image.match(/^(\d+)\.dkr\.ecr\.([^.]+)\.amazonaws\.com\/([^:]+)/))) {
    return { type: 'ecr', account: m[1], region: m[2], repository: m[3] };
  }
  // Google Artifact Registry:  <loc>-docker.pkg.dev/<project>/<repo>/<image>:<tag>
  if ((m = image.match(/^([a-z0-9-]+)-docker\.pkg\.dev\/([^/]+)\/([^/]+)\/([^:]+)/))) {
    const path = `${m[1]}-docker.pkg.dev/${m[2]}/${m[3]}/${m[4]}`;
    return { type: 'gar', path, repository: `${m[3]}/${m[4]}` };
  }
  // Legacy Google Container Registry:  gcr.io/<project>/<image>:<tag>
  if ((m = image.match(/^gcr\.io\/([^/]+)\/([^:]+)/))) {
    return { type: 'gcr', path: `gcr.io/${m[1]}/${m[2]}`, repository: m[2] };
  }
  // Azure Container Registry:  <registry>.azurecr.io/<repo>:<tag>
  if ((m = image.match(/^([^.]+)\.azurecr\.io\/([^:]+)/))) {
    return { type: 'acr', registry: m[1], repository: m[2] };
  }
  return null;
}

async function fetchEcrTags({ account, region, repository }) {
  const profile = ECR_PROFILE_MAP[account];
  const env = profile ? { ...process.env, AWS_PROFILE: profile } : process.env;
  const { stdout } = await execFileAsync('aws', [
    'ecr', 'describe-images',
    '--repository-name', repository,
    '--region', region,
    '--query', `sort_by(imageDetails,&imagePushedAt)[-${RECENT}:]`,
    '--output', 'json',
    '--no-cli-pager'
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024, env });
  return JSON.parse(stdout)
    .reverse()
    .flatMap(detail => detail.imageTags || [])
    .filter(Boolean);
}

async function fetchGarTags({ path }) {
  const { stdout } = await execFileAsync('gcloud', [
    'artifacts', 'docker', 'tags', 'list', path,
    '--format=json', `--limit=${RECENT}`
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Each entry: { tag: "<path>/tags/<name>", version: "sha256:..." }
  return JSON.parse(stdout)
    .map(t => (t.tag || '').split('/').pop())
    .filter(Boolean);
}

async function fetchGcrTags({ path }) {
  const { stdout } = await execFileAsync('gcloud', [
    'container', 'images', 'list-tags', path,
    '--format=json', `--limit=${RECENT}`
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Each entry: { tags: [...], timestamp, digest }
  return JSON.parse(stdout)
    .flatMap(entry => entry.tags || [])
    .filter(Boolean);
}

async function fetchAcrTags({ registry, repository }) {
  const { stdout } = await execFileAsync('az', [
    'acr', 'repository', 'show-tags',
    '--name', registry,
    '--repository', repository,
    '--top', String(RECENT),
    '--output', 'json'
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Flat array of tag strings.
  return JSON.parse(stdout).filter(Boolean);
}

const FETCHERS = {
  ecr: fetchEcrTags,
  gar: fetchGarTags,
  gcr: fetchGcrTags,
  acr: fetchAcrTags,
};

/**
 * GET /api/registry/tags?image=<full-image-url>
 * Detects the registry from the image URL, shells out to the matching cloud
 * CLI, and returns the most recent tags. Same response shape across registries.
 */
router.get('/registry/tags', async (req, res) => {
  const image = req.query.image;
  if (!image) {
    return res.status(400).json({ tags: [], repository: '', error: 'Missing image query parameter' });
  }

  const parsed = parseRegistry(image);
  if (!parsed) {
    return res.status(400).json({ tags: [], repository: '', error: 'Unsupported registry' });
  }

  const repository = parsed.repository;
  try {
    const tags = await FETCHERS[parsed.type](parsed);
    res.json({ tags, repository });
  } catch (error) {
    let errorMessage = (error.stderr || '').trim() || error.message;
    if (error.code === 'ENOENT') {
      errorMessage = `${CLI[parsed.type]} CLI not found — install it to load tags for this registry`;
    }
    console.error('registry tags error:', errorMessage);
    res.json({ tags: [], repository, error: errorMessage });
  }
});

module.exports = router;
