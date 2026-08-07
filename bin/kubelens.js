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

/**
 * Which copy of the server to run: the TypeScript source, or the .js that
 * `build:server` compiled from it.
 *
 * Decided by whether the source is here at all. The published package excludes
 * every .ts, so there only the compiled files exist; a clone has the sources,
 * and a clone is where someone is editing them.
 *
 * The old test was "is the compiled output missing?", which is a different
 * question and gave the wrong answer to this one. `prepack` runs build:server,
 * so any clone that has ever been packed or published has compiled output
 * sitting beside the sources — and the extensionless `require('api/index')`
 * below resolves .js before .ts even with the tsx hook loaded. Someone editing
 * api/routes/snapshot.ts and running `node bin/kubelens.js` to check it "the way
 * a user would" got the previous build, with nothing on screen to say so.
 */
const TS_ENTRY = path.join(pkgRoot, 'api', 'index.ts');
const fromSource = fs.existsSync(TS_ENTRY);

if (fromSource) {
  try {
    require('tsx/cjs');
  } catch {
    console.error('Running from a clone needs tsx, which is a devDependency here.');
    console.error('Run `pnpm install`, or use the published package.');
    process.exit(1);
  }
}

/** Resolve an entry point to the source in a clone, the compiled file otherwise. */
function entryPoint(...segments) {
  const base = path.join(pkgRoot, ...segments);
  return fromSource ? `${base}.ts` : `${base}.js`;
}

if (argv[0] === 'init') {
  const initEntry = entryPoint('scripts', 'init');
  process.argv = [process.argv[0], initEntry, ...argv.slice(1)];
  require(initEntry);
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
  require(entryPoint('api', 'index'));
}
