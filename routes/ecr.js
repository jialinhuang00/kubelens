const express = require('express');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const router = express.Router();

// ECR_PROFILE_MAP: maps AWS account ID → AWS SSO profile name (JSON)
// e.g. {"REDACTED_ACCOUNT":"PowerUserAccess-REDACTED_ACCOUNT"}
const ECR_PROFILE_MAP = (() => {
  try {
    return JSON.parse(process.env.ECR_PROFILE_MAP || '{}');
  } catch {
    return {};
  }
})();

/**
 * GET /api/ecr/tags?image=<full-ecr-image-url>
 * Parses ECR repo name + region from the image URL,
 * then calls `aws ecr describe-images` to return the 10 most recent tags.
 */
router.get('/ecr/tags', async (req, res) => {
  const image = req.query.image;
  if (!image) {
    return res.status(400).json({ tags: [], error: 'Missing image query parameter' });
  }

  // Parse ECR image URL: <account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>
  const match = image.match(/^(\d+)\.dkr\.ecr\.([^.]+)\.amazonaws\.com\/([^:]+)/);
  if (!match) {
    return res.status(400).json({ tags: [], error: 'Not a valid ECR image URL' });
  }

  const accountId = match[1];
  const region = match[2];
  const repository = match[3];

  // Look up profile for this account
  const profile = ECR_PROFILE_MAP[accountId];
  const env = profile ? { ...process.env, AWS_PROFILE: profile } : process.env;

  try {
    const { stdout } = await execFileAsync('aws', [
      'ecr', 'describe-images',
      '--repository-name', repository,
      '--region', region,
      '--query', 'sort_by(imageDetails,&imagePushedAt)[-10:]',
      '--output', 'json',
      '--no-cli-pager'
    ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024, env });

    const imageDetails = JSON.parse(stdout);
    // Flatten all imageTags from the results, newest first
    const tags = imageDetails
      .reverse()
      .flatMap(detail => detail.imageTags || [])
      .filter(tag => tag); // remove empty

    res.json({ tags, repository });
  } catch (error) {
    const errorMessage = (error.stderr || '').trim() || error.message;
    console.error('ECR describe-images error:', errorMessage);
    res.json({ tags: [], repository, error: errorMessage });
  }
});

module.exports = router;
