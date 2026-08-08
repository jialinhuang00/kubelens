# kubelens Project Context

## Architecture
- Angular 20+ standalone components with signals
- Express.js backend (`api/index.ts` + `api/routes/`) with Go backend (`cmd/server/`)
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
- `pnpm run init` generates `kubelens.config.yaml` for the current cluster: built-ins from `kubelens.default.yaml` + CRDs discovered via `kubectl api-resources` (shipped `default: []`, off). Pure detection logic in `api/utils/init-detect.ts` (unit-tested); `--force`/`--merge` flags.
- Image tag lookups are registry-agnostic: `/api/registry/tags` detects ECR/GCR/ACR from the image URL and shells out to `aws`/`gcloud`/`az`.
- Snapshot mode replays from the same objects real kubectl reads (e.g. rollout history rebuilds from exported ReplicaSets' revision annotations; old snapshots without `replicasets.yaml` fall back to synthesized rows). Still canned/fake: `get events`, and `get namespaces` when the snapshot dir is missing — don't trust those outputs.
- The export kind list lives in FIVE places that must stay in sync: bash `NS_BATCHES`, `snapshot-node.js` / `-workers` / `-procs` `NS_BATCHES`, Go `nsBatches` (+ `kind-map.json` / `kindmap.go` for filenames). Same five-way duplication for the two dotfiles every exporter writes: `.export-context` (after the clean, `{context, startedAt}`; fresh run overwrites, `--resume` keeps) and `.export-complete` (after the last namespace, `{context, exportedAt, exporter}`). Miss one and that mode's snapshots silently carry no cluster name.
- `cmd/server`: package-level `var`s init BEFORE `main()` chdirs to `PROJECT_ROOT` — never resolve config/files in a package-level initializer (that's why `fileAliases` is lazy). Also: Node passes config YAML through as-is, but Go re-declares typed structs — a config field/section not mirrored in `store/config.go` silently vanishes. That is not only `/api/config`: the `tables:` section had no Go struct at all until 2026-08-07, and Snapshot mode on `dev:go` answered ten of the seventeen kinds with a bare list of names. Anything hardcoded in Go that Node derives from config is the same bug waiting (`ResourceFileMap` was the other one). `api/utils/table-parity.itest.ts` renders the same items through both and compares.
- Go route parity is by hand and drifts silently. Renaming a Node route without renaming the Go one leaves `dev:go` answering 404 with nothing in the logs (that's how `/api/snapshot` sat broken from 2026-03-07 to 2026-08-07), and a field added to a Node JSON response is absent in Go until someone adds it to `writeJSON`'s map. Change one side, change both, then `pnpm run test:go`.
- The exporters' stdout is a third interface between the two backends, next to the route names and the JSON fields, and it drifted the same way. Both routes parse it with their own regexes (`api/utils/export-progress.ts`, `applyProgressChunk` in `cmd/server/routes/k8s_export.go`), and both were wrong about it until 2026-08-07: bash padded its namespace tag inside the brackets where the other four pad outside, and Go's patterns had no tag at all. Change what an exporter prints and both parsers need changing. `scripts/capture-exporter-output.sh` recaptures `test-fixtures/exporter-stdout/`, which both test suites read.
- Export state (`paused`, `pausedDismissed`) lives in server memory on both backends but `paused` is recomputed from disk every poll — files present with no `.export-complete`. Clearing an in-memory flag alone gets undone one second later; that's why dismiss needs `pausedDismissed`, ANDed into the derived value and reset by any new export.
- Where `k8s-snapshot` lives is decided in exactly three places, one per runtime, and they have to agree: `snapshotDir()` in `api/utils/paths.ts`, `store.SnapshotDir()` in `cmd/server/store/loader.go`, and `$K8S_SNAPSHOT_DIR / $K8S_SNAPSHOT_PATH` in the five exporters. All read `K8S_SNAPSHOT_PATH` first and otherwise use `<cwd>/k8s-snapshot`; the exporters also take `K8S_SNAPSHOT_DIR`, which is what the export route passes them explicitly rather than letting them infer from cwd. No package fallback, and nothing resolved at import (Go's package-level `var`s run before `main()` chdirs).
- Every arrangement other than that one has shipped a silent bug. Read with a package fallback and write without: an export from a subdirectory landed in `api/k8s-snapshot` while Snapshot mode kept reading the checkout's copy. Resolve lazily but keep the fallback: after `discard` removed the user's directory the next delete found the package's. Route honours `K8S_SNAPSHOT_PATH` while exporters only honour `K8S_SNAPSHOT_DIR`: the export ran, wrote elsewhere, and the file count sat at 0 with no error. None of these crash — the tests that catch them compare the resolvers against each other (`api/utils/paths.spec.ts`, `cmd/server/routes/snapshot_dir_test.go`), not each against a fixed string.
- The paused panel reads `.export-context`, never `.export-complete`: "paused" means the completion marker is missing, so it can't be the thing that records the cluster. `GET /api/snapshot` returns `snapshotContext` + `currentContext` only while paused — a running export polls every second and each lookup spawns kubectl.

## File Structure
```
├── bin/kubelens.js            # CLI entry. Runs api/index.ts in a clone (tsx),
│                              #   api/index.js from the package — decided by
│                              #   whether the .ts is present, not by whether a
│                              #   build exists
├── api/                       # All TypeScript; build:server emits .js twins (gitignored)
│   ├── index.ts               # Express entry point
│   ├── routes/
│   │   ├── execute.ts         #   POST /api/execute + WebSocket /api/execute/stream/ws
│   │   ├── graph.ts           #   GET  /api/graph — resource topology
│   │   ├── snapshot.ts        #   POST/GET /api/snapshot — export control + progress
│   │   ├── snapshot.spec.ts   #   Route tests: real Express app, Node's fetch, no mocks
│   │   ├── status.ts          #   GET  /api/realtime/ping, /api/snapshot/ping
│   │   ├── registry.ts        #   GET  /api/registry/tags — image tags (ECR/GCR/ACR by URL)
│   │   ├── config.ts          #   GET  /api/config — resource kinds from kubelens.config.yaml
│   │   └── discovery.ts       #   GET  /api/api-resources — cluster's kinds (kubectl api-resources)
│   └── utils/
│       ├── config-loader.ts    #   Loads + caches kubelens.config.yaml (resources, aliases)
│       ├── api-resources.ts    #   Parser for `kubectl api-resources` table (shared: discovery + init)
│       ├── init-detect.ts      #   `kubelens init` detection (cluster/registry/CRD), unit-tested
│       ├── snapshot-handler.ts #   Re-export shim (handleCommand, parseKubectlCommand)
│       ├── snapshot-loader.ts  #   Constants, cache, YAML/text file loading
│       ├── snapshot-parsers.ts #   Table generators, describe generators, helpers
│       ├── snapshot-commands.ts#   Command parser + all kubectl action handlers
│       ├── export-progress.ts #   Parses exporter stdout into progress state (Go twin: applyProgressChunk)
│       ├── tail.ts          #   Trims stderr without splitting a character (Go twin: tailBytes)
│       └── graph-builder.ts   #   Graph construction logic (buildGraph, extractWorkloadEdges)
├── cmd/server/                # Go backend (mirrors Node.js routes)
│   └── routes/
│       ├── execute.go         #   POST /api/execute
│       ├── stream.go          #   WebSocket /api/execute/stream/ws + stop/clear
│       ├── graph.go           #   GET  /api/graph
│       ├── k8s_export.go      #   GET/POST /api/snapshot — export control + progress
│       ├── k8s_export_test.go #   httptest coverage for the command dispatch + paused state
│       ├── snapshot_dir_test.go #  export route, ping and loader must resolve the same directory
│       ├── status.go          #   ping endpoints
│       ├── registry.go        #   GET  /api/registry/tags — image tags (ECR/GCR/ACR by URL)
│       ├── discovery.go       #   GET  /api/api-resources — cluster's kinds
│       └── config.go          #   GET  /api/config — resource kinds (store/config.go loads it)
│   └── store/
│       └── table.go           #   Config-driven `kubectl get` tables (twin of snapshot-parsers.ts)
├── scripts/                   # CLI tools (bash 3.2 compatible)
│   ├── snapshot-bash.sh       #   Parallel batched cluster export
│   ├── snapshot-node.js       #   Node.js sequential export
│   ├── snapshot-node-workers.js # Node.js worker_threads export
│   ├── snapshot-node-procs.js #   Node.js child_process export
│   ├── split-resources.js     #   Splits kubectl JSON into per-kind YAML files
│   ├── init.ts                #   `pnpm run init` — generate kubelens.config.yaml from the cluster
│   ├── capture-exporter-output.sh # Recaptures test-fixtures/exporter-stdout/ from a live cluster
│   ├── capture-table-fixtures.js  # Rebuilds test-fixtures/table-items.json (one item per table kind)
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
├── test-fixtures/             # Committed captures both test suites read (exporter-stdout/, table-items.json)
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
Frontend → `api/routes/execute.ts` → `execFile('kubectl', ...)` → live cluster

### Snapshot Mode
Frontend → `api/routes/execute.ts` → `snapshot-handler.ts` → reads `k8s-snapshot/*.yaml`

### Export
Home page → `api/routes/snapshot.ts` → spawns export script → writes `k8s-snapshot/`
- Multiple export modes: bash, node, workers, procs, go
- Progress: stdout parsing → in-memory `exportState` → polled by frontend every 1s
- `.export-complete` marker = snapshot available; `.export-context` = which cluster it came from
- Interrupted export → paused panel with three exits: Resume, Start over (`command: 'discard'`, deletes the directory), or dismiss (`command: 'clear'`)

### Streaming (WebSocket)
Frontend → `websocket.service.ts` → `ws://host/api/execute/stream/ws` → server spawns kubectl →
pushes `stream-data` chunks → `stream-end` on completion.
Control: `POST /api/execute/stream/stop` (kill process), `POST /api/execute/stream/clear` (clear buffer).

## Development
- `pnpm run dev` — frontend (4200) + backend (3042), proxy forwards `/api`
- `pnpm run dev:go` — same ports, Go backend instead of Node
- `bash scripts/snapshot-bash.sh` — CLI export (independent of server)
- `ng test` — Unit tests
- `pnpm run test:utils` — Backend unit tests: `api/utils/**/*.spec.ts` + `api/routes/**/*.spec.ts`. Hermetic: zero kubectl calls, and `K8S_SNAPSHOT_PATH` points at a nonexistent path so nothing reads a real export. `snapshot-commands.spec.ts` seeds `snapshot-loader`'s cache with fixtures; `routes/snapshot.spec.ts` starts a real Express app on an ephemeral port, drives it with Node's `fetch`, and refuses to run if the route resolves anywhere but its temp directory.
- `pnpm run test:types` — `tsc -p tsconfig.check.json`, nothing emitted. `test:utils` runs through tsx, which strips types without checking them, so a suite can be green on code that does not compile. Covers the specs and itests too; `tsconfig.publish.json` excludes those, so nothing was checking them.
- `pnpm run test:go` — Go backend tests (`net/http/httptest`, no cluster needed).
- The Snapshot-mode table format has THREE implementations, not two: `renderTable` (Node), `RenderTable` (Go), and the frontend splitting the text back into cells on `/\s{2,}/` (`dashboard/services/output-parser.service.ts`). `pad()` therefore guarantees a two-space gap however long the value is — a one-space gap reads fine and merges two columns into one cell. `api/utils/table-roundtrip.spec.ts` drives the real frontend service with the real backend renderer; it is the only test that crosses that boundary.
- The Terminal sidebar lists a namespace's resources with one `kubectl get <a,b,c> -n <ns> -o name` call and reads `<namePrefix>/<name>` back. Go had no `-o name` path until 2026-08-08 and returned a table, so the sidebar under `dev:go` expanded nothing. Comma-joined kinds appear nowhere else.
- `-o name` prefixes are canonical, never the alias the caller typed: `kubectl get ep` answers `endpoints/x`. Kinds the snapshot exports but `resources:` has no entry for (Endpoints, PodDisruptionBudget) need their prefix listed by hand — `SNAPSHOT_EXTRA_PREFIX` in `snapshot-commands.ts`, `snapshotExtraPrefix` in `store/commands.go` — because there is no config entry to read it from. Both were verified against kubectl, not derived.
- `pnpm run test:parity` — `api/**/*.itest.ts`. The one suite that deliberately shells out: it runs a real exporter and a real `go run` to compare the directory each implementation resolves, recaptures every exporter's stdout to check `test-fixtures/exporter-stdout/` is not stale, and renders every `tables:` kind through both backends to compare the text. None of those is readable from one side alone. Needs a reachable cluster and a Go toolchain, and skips (not fakes) when either is missing. Kept out of `test:utils` so "zero external calls" stays a measurable property there.
- No test drives `command: 'start'` on either backend — every mode spawns a real exporter against the live kubeconfig. Go covers the mode-to-command mapping by keeping it in a pure `exporterCommand`; the Node handler still has that switch inline.
- `pnpm test` — Angular unit tests (Karma). Was two failures from 2026-03-13 to 2026-08-08 because `app.spec.ts` was still the CLI template; a suite nobody can run is a suite nobody notices breaking.
- `pnpm run test:e2e` — Playwright, driving the Chrome already on the machine (`channel: 'chrome'` in `playwright.config.ts`). No `npx playwright install` needed and no second browser on disk; the trade is that Chrome auto-updates, so the browser under test drifts. If it ever errors about a missing `chromium_headless_shell-<n>`, that `channel` line has been dropped — the revision number is what this Playwright pins, not a version to chase.

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
| Start | `PORT=8080 pm2 start "npx tsx api/index.ts" --name kubelens` |

Frontend: `npm run build` → `dist/kubelens/browser/` (static files). Backend: no build, tsx runs directly.
Production mode: Express serves `dist/` + API on one port. Dev mode: `dist/` absent → static serve skipped.

The deploy block is the one place that still says `npm` — everything local uses `pnpm`, matching `pnpm-lock.yaml`. Whether the EC2 host has pnpm installed has never been checked from here, so the command stays as written until someone runs `ssh kubelens 'which pnpm'`.

## Release to npm

Published as [`kubelens`](https://www.npmjs.com/package/kubelens). `npm publish` needs a 2FA one-time password, so that step is run by hand.

```
npm version <patch|minor|major> --no-git-tag-version
git commit + git push                    # chore(release): x.y.z
npm publish --otp=<code>                 # prepublishOnly runs ng build; prepack runs build:server
rm -rf ~/.npm/_npx && npx kubelens        # verify from the registry, not a local tarball
```

- Verify by publishing then running `npx`, not by installing a tarball. Four bugs shipped in 0.1.0 that `npm install <tgz>` could not reach — deep links 404'd because the npx cache path contains a dot, and a finished export left the UI unusable. See `bin/kubelens.js`, `api/index.ts` SPA fallback, `api/routes/status.ts`, `api/routes/graph.ts`.
- To remove a version, publish the replacement **first**. `npm unpublish` on the last remaining version locks the package name for 24 hours. A version number is burned permanently once unpublished; it can never be reused.
- `npx --package=<path-to-tgz> kubelens` exercises the npx cache path without publishing — the closest dry run available.

## Important Constraints
- bash scripts must work on macOS bash 3.2 (no `declare -A`, empty arrays + `set -u` crash)
- `snapshot-loader.ts` uses in-memory cache — only blocks on first call per resource
- Snapshot dependencies: `parsers` → `loader`, `commands` → `loader` + `parsers`, `handler` → `loader` + `commands`
- Build warnings for regl/seedrandom CommonJS modules are expected (cosmos dependency)
- Graph endpoint (realtime) batches kubectl calls from `kubelens.config.yaml`: one combined call for built-in kinds + one per CRD; ingest keys on `group/kind` (not kind alone) to avoid Kind-name collisions across API groups
