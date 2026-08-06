# kubelens Project Context

## Architecture
- Angular 20+ standalone components with signals
- Express.js backend (`api/index.js` + `api/routes/`) with Go backend (`cmd/server/`)
- TypeScript with strict compilation
- Nord theme (`#88c0d0` accent on `#2e3440` background) — single theme, folded into `:root` in `styles.scss` (no runtime switching, no `[data-theme]` blocks)
- Dual data mode: **Realtime** (live kubectl) and **Snapshot** (offline `k8s-snapshot/`)

## Key Patterns
- `inject()` pattern (no constructor DI)
- `DestroyRef` + `takeUntilDestroyed()` for subscription cleanup
- `execFile` instead of `exec` to prevent shell injection
- `fs.promises` (async) for all file I/O in polled endpoints
- Snapshot mode: per-request `?snapshot=true` via HTTP interceptor
- Resource kinds (which kinds appear in tree + graph) come from `kubelens.config.yaml` via `GET /api/config` (frontend `ConfigService`, backend `config-loader`). Add a kind there, not in code. Per kind: `show` = capability (which views it CAN appear in), `default` = default-on views (subset of `show`; omit = same as `show`). `default: []` ships a kind capable-but-off.
- `npm run init` generates `kubelens.config.yaml` for the current cluster: built-ins from `kubelens.default.yaml` + CRDs discovered via `kubectl api-resources` (shipped `default: []`, off). Pure detection logic in `api/utils/init-detect.ts` (unit-tested); `--force`/`--merge` flags.
- Image tag lookups are registry-agnostic: `/api/registry/tags` detects ECR/GCR/ACR from the image URL and shells out to `aws`/`gcloud`/`az`.
- Snapshot mode replays from the same objects real kubectl reads (e.g. rollout history rebuilds from exported ReplicaSets' revision annotations; old snapshots without `replicasets.yaml` fall back to synthesized rows). Still canned/fake: `get events`, and `get namespaces` when the snapshot dir is missing — don't trust those outputs.
- The export kind list lives in FIVE places that must stay in sync: bash `NS_BATCHES`, `snapshot-node.js` / `-workers` / `-procs` `NS_BATCHES`, Go `nsBatches` (+ `kind-map.json` / `kindmap.go` for filenames).
- `cmd/server`: package-level `var`s init BEFORE `main()` chdirs to `PROJECT_ROOT` — never resolve config/files in a package-level initializer (that's why `fileAliases` is lazy). Also: Node passes config YAML through as-is, but Go re-declares typed structs — a config field/section not mirrored in `store/config.go` silently vanishes from `/api/config`.

## File Structure
```
├── api/
│   ├── index.js               # Express entry point
│   ├── routes/
│   │   ├── execute.js         #   POST /api/execute + WebSocket /api/execute/stream/ws
│   │   ├── graph.js           #   GET  /api/graph — resource topology
│   │   ├── snapshot.js        #   POST/GET /api/snapshot — export control + progress
│   │   ├── status.js          #   GET  /api/realtime/ping, /api/snapshot/ping
│   │   ├── registry.js        #   GET  /api/registry/tags — image tags (ECR/GCR/ACR by URL)
│   │   ├── config.js          #   GET  /api/config — resource kinds from kubelens.config.yaml
│   │   └── discovery.js       #   GET  /api/api-resources — cluster's kinds (kubectl api-resources)
│   └── utils/
│       ├── config-loader.ts    #   Loads + caches kubelens.config.yaml (resources, aliases)
│       ├── api-resources.ts    #   Parser for `kubectl api-resources` table (shared: discovery + init)
│       ├── init-detect.ts      #   `kubelens init` detection (cluster/registry/CRD), unit-tested
│       ├── snapshot-handler.ts #   Re-export shim (handleCommand, parseKubectlCommand)
│       ├── snapshot-loader.ts  #   Constants, cache, YAML/text file loading
│       ├── snapshot-parsers.ts #   Table generators, describe generators, helpers
│       ├── snapshot-commands.ts#   Command parser + all kubectl action handlers
│       └── graph-builder.ts   #   Graph construction logic (buildGraph, extractWorkloadEdges)
├── cmd/server/                # Go backend (mirrors Node.js routes)
│   └── routes/
│       ├── execute.go         #   POST /api/execute
│       ├── stream.go          #   WebSocket /api/execute/stream/ws + stop/clear
│       ├── graph.go           #   GET  /api/graph
│       ├── k8s_export.go      #   export control + progress
│       ├── status.go          #   ping endpoints
│       ├── registry.go        #   GET  /api/registry/tags — image tags (ECR/GCR/ACR by URL)
│       └── config.go          #   GET  /api/config — resource kinds (store/config.go loads it)
├── scripts/                   # CLI tools (bash 3.2 compatible)
│   ├── snapshot-bash.sh       #   Parallel batched cluster export
│   ├── snapshot-node.js       #   Node.js sequential export
│   ├── snapshot-node-workers.js # Node.js worker_threads export
│   ├── snapshot-node-procs.js #   Node.js child_process export
│   ├── split-resources.js     #   Splits kubectl JSON into per-kind YAML files
│   ├── init.ts                #   `npm run init` — generate kubelens.config.yaml from the cluster
│   └── kind-map.json          #   Kind → filename mapping
├── src/app/
│   ├── core/services/         #   kubectl, config, data-mode, snapshot, websocket, execution-context, theme
│   └── features/
│       ├── home/              #   Landing page — mode toggle, export UI
│       ├── dashboard/         #   Command execution terminal (executor service extracted)
│       ├── terminal/          #   Terminal UI
│       ├── universe/          #   GPU-accelerated graph (@cosmograph/cosmos)
│       ├── knowledge/         #   K8s field relationship viewer
│       ├── benchmark/         #   Export optimization story
│       └── k8s/               #   K8s resource views
├── kubelens.config.yaml       # Source of truth for resource kinds (tree + graph)
├── kubelens.default.yaml      # Neutral built-ins base for `kubelens init`; the CLI also copies it to config.yaml on first run
└── k8s-snapshot/              # Exported cluster data (gitignored)
```

## Communication Patterns

All endpoints use **REST** (request-response) except:

- **WebSocket** — `execute.js` / `stream.go`: kubectl streaming for long-running commands (`rollout status`).
  Frontend opens native WebSocket per stream via `websocket.service.ts` → `connectStream()`.
  Node.js uses `ws` library, Go uses `gorilla/websocket`.
- **REST polling** — export progress: frontend polls `GET /api/snapshot` every 1s.
  Export script writes to stdout → Node.js parses with regex → updates in-memory `exportState` →
  polling handler reads `exportState` + counts disk files → returns JSON.
  If server restarts, `exportState` resets; fallback counts `.done` markers on disk.

## Data Flow

### Realtime Mode
Frontend → `api/routes/execute.js` → `execFile('kubectl', ...)` → live cluster

### Snapshot Mode
Frontend → `api/routes/execute.js` → `snapshot-handler.ts` → reads `k8s-snapshot/*.yaml`

### Export
Home page → `api/routes/snapshot.js` → spawns export script → writes `k8s-snapshot/`
- Multiple export modes: bash, node, workers, procs, go
- Progress: stdout parsing → in-memory `exportState` → polled by frontend every 1s
- `.export-complete` marker = snapshot available

### Streaming (WebSocket)
Frontend → `websocket.service.ts` → `ws://host/api/execute/stream/ws` → server spawns kubectl →
pushes `stream-data` chunks → `stream-end` on completion.
Control: `POST /api/execute/stream/stop` (kill process), `POST /api/execute/stream/clear` (clear buffer).

## Development
- `npm run dev` — frontend (4200) + backend (3042), proxy forwards `/api`
- `bash scripts/snapshot-bash.sh` — CLI export (independent of server)
- `ng test` — Unit tests
- `npm run test:utils` — Backend unit tests. Points `K8S_SNAPSHOT_PATH` at a nonexistent path so nothing reads a real export; `snapshot-commands.spec.ts` seeds `snapshot-loader`'s in-memory cache with fixtures instead.
- `npm run test:e2e` — Playwright. Starts the dev server itself; first run needs `npx playwright install chromium` (or add `channel: 'chrome'` to use the system browser).

## Deploy (EC2)

```bash
git push                          # local
ssh kubelens                      # ~/.ssh/config alias
cd /home/ec2-user/kubelens
git pull
npm run build                     # only if frontend changed
pm2 restart kubelens
```

| Item | Value |
|------|-------|
| Path | `/home/ec2-user/kubelens/` |
| Port | 8080 (`PORT=8080` in pm2 env) |
| Start | `PORT=8080 pm2 start "npx tsx api/index.js" --name kubelens` |

Frontend: `npm run build` → `dist/kubelens/browser/` (static files). Backend: no build, tsx runs directly.
Production mode: Express serves `dist/` + API on one port. Dev mode: `dist/` absent → static serve skipped.

## Release to npm

Published as [`kubelens`](https://www.npmjs.com/package/kubelens). `npm publish` needs a 2FA one-time password, so that step is run by hand.

```
npm version <patch|minor|major> --no-git-tag-version
git commit + git push                    # chore(release): x.y.z
npm publish --otp=<code>                 # prepublishOnly runs ng build; prepack runs build:server
rm -rf ~/.npm/_npx && npx kubelens        # verify from the registry, not a local tarball
```

- Verify by publishing then running `npx`, not by installing a tarball. Four bugs shipped in 0.1.0 that `npm install <tgz>` could not reach — deep links 404'd because the npx cache path contains a dot, and a finished export left the UI unusable. See `bin/kubelens.js`, `api/index.js` SPA fallback, `api/routes/status.js`, `api/routes/graph.js`.
- To remove a version, publish the replacement **first**. `npm unpublish` on the last remaining version locks the package name for 24 hours. A version number is burned permanently once unpublished; it can never be reused.
- `npx --package=<path-to-tgz> kubelens` exercises the npx cache path without publishing — the closest dry run available.

## Important Constraints
- bash scripts must work on macOS bash 3.2 (no `declare -A`, empty arrays + `set -u` crash)
- `snapshot-loader.ts` uses in-memory cache — only blocks on first call per resource
- Snapshot dependencies: `parsers` → `loader`, `commands` → `loader` + `parsers`, `handler` → `loader` + `commands`
- Build warnings for regl/seedrandom CommonJS modules are expected (cosmos dependency)
- Graph endpoint (realtime) batches kubectl calls from `kubelens.config.yaml`: one combined call for built-in kinds + one per CRD; ingest keys on `group/kind` (not kind alone) to avoid Kind-name collisions across API groups
