#!/usr/bin/env node
// CLI entry point for the published npm package.
// `npx kubelens`        — start the server (static frontend + API on one port)
// `npx kubelens init`   — generate kubelens.config.yaml from the current cluster

const path = require('path');
const fs = require('fs');

const pkgRoot = path.join(__dirname, '..');
const argv = process.argv.slice(2);

function help() {
  console.log(`
kubelens — browser-based Kubernetes visualization

Usage:
  kubelens [--port <n>]     start the server (default port 3042)
  kubelens init [--force|--merge]
                            generate kubelens.config.yaml from the current cluster
  kubelens --version
  kubelens --help

Requires kubectl configured for your cluster (Realtime mode).
Snapshot mode works offline once a snapshot has been exported.
`);
}

if (argv.includes('--help') || argv.includes('-h')) {
  help();
  process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  console.log(require(path.join(pkgRoot, 'package.json')).version);
  process.exit(0);
}

/**
 * A clone ships kubelens.config.yaml in the repo, so `pnpm run dev` shows the
 * built-in kinds without any setup. Installed from npm that file is absent —
 * it describes the user's cluster, not the package — and an empty config means
 * an empty tree and an empty graph. Copy the neutral seed into the working
 * directory on first run so the two entry points behave the same. `init` stays
 * opt-in: it needs a reachable cluster, which a snapshot-only user may not have.
 */
function seedConfig() {
  const target = path.join(process.cwd(), 'kubelens.config.yaml');
  if (fs.existsSync(target)) return;

  const seed = path.join(pkgRoot, 'kubelens.default.yaml');
  if (!fs.existsSync(seed)) return;

  try {
    fs.copyFileSync(seed, target);
    console.log(`Wrote ${target} from the built-in defaults.`);
    console.log('Run `kubelens init` to detect your cluster\'s CRDs and image registry.');
  } catch (e) {
    console.warn(`Could not write kubelens.config.yaml: ${e.message}`);
    console.warn('The tree and graph will be empty. Run kubelens from a writable directory.');
  }
}

// api/utils and scripts/init are TypeScript — register tsx's CommonJS hook first.
require('tsx/cjs');

if (argv[0] === 'init') {
  process.argv = [process.argv[0], path.join(pkgRoot, 'scripts', 'init.ts'), ...argv.slice(1)];
  require(path.join(pkgRoot, 'scripts', 'init.ts'));
} else {
  const portFlag = argv.indexOf('--port');
  if (portFlag !== -1 && argv[portFlag + 1]) {
    process.env.PORT = argv[portFlag + 1];
  }

  const distPath = path.join(pkgRoot, 'dist', 'kubelens', 'browser');
  if (!fs.existsSync(distPath)) {
    console.error(`No frontend build found at ${distPath} — this package was published without dist/.`);
    process.exit(1);
  }

  seedConfig();
  require(path.join(pkgRoot, 'api', 'index.js'));
}
