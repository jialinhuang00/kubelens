import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const router = express.Router();

// Number of most-recent tags to return.
const RECENT = 20;

// ECR_PROFILE_MAP: maps AWS account ID → AWS SSO profile name (JSON)
// e.g. {"123456789012":"PowerUserAccess-123456789012"}
const ECR_PROFILE_MAP: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.ECR_PROFILE_MAP || '{}');
  } catch {
    return {};
  }
})();

type RegistryType = 'ecr' | 'gar' | 'gcr' | 'acr';

/** What each fetcher needs, keyed by which registry the URL turned out to be. */
type ParsedRegistry =
  | { type: 'ecr'; account: string; region: string; repository: string }
  | { type: 'gar'; path: string; repository: string }
  | { type: 'gcr'; path: string; repository: string }
  | { type: 'acr'; registry: string; repository: string };

/** A failed execFile carries the child's output and an errno code. */
interface ExecError extends Error {
  code?: string;
  stderr?: string;
}

// CLI binary each registry type shells out to — used for the "not installed" hint.
const CLI: Record<RegistryType, string> = { ecr: 'aws', gar: 'gcloud', gcr: 'gcloud', acr: 'az' };

/**
 * Classify an image URL by its registry host and pull out the parts each
 * fetcher needs. Returns null for hosts we don't support.
 */
function parseRegistry(image: string): ParsedRegistry | null {
  let m: RegExpMatchArray | null;
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

async function fetchEcrTags({ account, region, repository }: Extract<ParsedRegistry, { type: 'ecr' }>): Promise<string[]> {
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
  const details: Array<{ imageTags?: string[] }> = JSON.parse(stdout);
  return details
    .reverse()
    .flatMap(detail => detail.imageTags || [])
    .filter(Boolean);
}

async function fetchGarTags({ path }: Extract<ParsedRegistry, { type: 'gar' }>): Promise<string[]> {
  const { stdout } = await execFileAsync('gcloud', [
    'artifacts', 'docker', 'tags', 'list', path,
    '--format=json', `--limit=${RECENT}`
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Each entry: { tag: "<path>/tags/<name>", version: "sha256:..." }
  const entries: Array<{ tag?: string }> = JSON.parse(stdout);
  return entries
    .map(t => (t.tag || '').split('/').pop() as string)
    .filter(Boolean);
}

async function fetchGcrTags({ path }: Extract<ParsedRegistry, { type: 'gcr' }>): Promise<string[]> {
  const { stdout } = await execFileAsync('gcloud', [
    'container', 'images', 'list-tags', path,
    '--format=json', `--limit=${RECENT}`
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Each entry: { tags: [...], timestamp, digest }
  const entries: Array<{ tags?: string[] }> = JSON.parse(stdout);
  return entries
    .flatMap(entry => entry.tags || [])
    .filter(Boolean);
}

async function fetchAcrTags({ registry, repository }: Extract<ParsedRegistry, { type: 'acr' }>): Promise<string[]> {
  const { stdout } = await execFileAsync('az', [
    'acr', 'repository', 'show-tags',
    '--name', registry,
    '--repository', repository,
    '--top', String(RECENT),
    '--output', 'json'
  ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  // Flat array of tag strings.
  const tags: string[] = JSON.parse(stdout);
  return tags.filter(Boolean);
}

/** Dispatch on the discriminant so each fetcher only sees the fields it parses. */
function fetchTags(parsed: ParsedRegistry): Promise<string[]> {
  switch (parsed.type) {
    case 'ecr': return fetchEcrTags(parsed);
    case 'gar': return fetchGarTags(parsed);
    case 'gcr': return fetchGcrTags(parsed);
    case 'acr': return fetchAcrTags(parsed);
  }
}

/**
 * GET /api/registry/tags?image=<full-image-url>
 * Detects the registry from the image URL, shells out to the matching cloud
 * CLI, and returns the most recent tags. Same response shape across registries.
 */
router.get('/registry/tags', async (req: Request, res: Response) => {
  const image = typeof req.query.image === 'string' ? req.query.image : '';
  if (!image) {
    return res.status(400).json({ tags: [], repository: '', error: 'Missing image query parameter' });
  }

  const parsed = parseRegistry(image);
  if (!parsed) {
    return res.status(400).json({ tags: [], repository: '', error: 'Unsupported registry' });
  }

  const repository = parsed.repository;
  try {
    const tags = await fetchTags(parsed);
    res.json({ tags, repository });
  } catch (err) {
    const error = err as ExecError;
    let errorMessage = (error.stderr || '').trim() || error.message;
    if (error.code === 'ENOENT') {
      errorMessage = `${CLI[parsed.type]} CLI not found — install it to load tags for this registry`;
    }
    console.error('registry tags error:', errorMessage);
    res.json({ tags: [], repository, error: errorMessage });
  }
});

export = router;
