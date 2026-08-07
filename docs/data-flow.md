# Data Flow

Who calls whom, from a click in the browser down to `kubectl`. Read this before touching `api/routes/` or any frontend service.

Two backends live in this repo. The Node backend (`api/index.ts`, Express 5) is what `pnpm run dev` runs and what this doc describes. The Go backend under `cmd/server/` is a parallel implementation, reached by `pnpm run dev:go`, and not covered here. It answers the same paths on purpose, and keeping it that way is manual: rename a route on one side only and `dev:go` starts returning 404 with nothing in the logs. That is exactly what happened to `/api/snapshot` between 2026-03-07 and 2026-08-07.

## HTTP endpoints

All routers mount under `/api` (`api/index.ts:39-45`). In prod, anything outside `/api/` falls through to the SPA's `index.html` (`api/index.ts:54`).

Everything under `api/` is TypeScript. `build:server` compiles each file to a `.js` beside it so the published package runs on plain node; those twins are gitignored build output. Keeping the sources uniformly `.ts` is what makes the twins harmless: under `tsx` a require resolves by the *importer's* extension, so a lone `.js` file in here would load the compiled copy of its dependencies while everything else loaded the sources.

| Method | Path | Handler | Returns |
|---|---|---|---|
| GET | `/api/graph` | `api/routes/graph.ts:99` | `{nodes, edges, pods, namespaces, stats}` |
| POST | `/api/execute` | `api/routes/execute.ts:189` | `{success, stdout, command}`; one kubectl run |
| POST | `/api/execute/stream/stop` | `api/routes/execute.ts:248` | kills a stream's process by `streamId` |
| POST | `/api/execute/stream/clear` | `api/routes/execute.ts:265` | clears a stream's buffer |
| GET | `/api/config` | `api/routes/config.ts:9` | `{resources, templates}` from `kubelens.config.yaml` |
| GET | `/api/api-resources` | `api/routes/discovery.ts:30` | discovered kinds from `kubectl api-resources` |
| GET | `/api/registry/tags` | `api/routes/registry.ts:137` | image tags; detects ECR/GAR/GCR/ACR from `?image=` |
| POST | `/api/snapshot` | `api/routes/snapshot.ts:122` | export control: `start` / `stop` / `clear` / `discard` |
| GET | `/api/snapshot` | `api/routes/snapshot.ts:360` | export progress (running, totals, ETA, contexts) |
| GET | `/api/realtime/ping` | `api/routes/status.ts:20` | kubectl health + version |
| GET | `/api/export/ping` | `api/routes/status.ts:64` | is GNU `parallel` installed |
| GET | `/api/snapshot/ping` | `api/routes/status.ts:74` | does `k8s-snapshot/.export-complete` exist |
| GET | `/api/debug/memory` | `api/index.ts:21` | rss / heap in MB |

Every `/api/` request can carry `?snapshot=true`. The frontend never adds it by hand: `snapshotInterceptor` (`src/app/core/interceptors/snapshot.interceptor.ts:10`) appends it to all `/api/` calls while snapshot mode is on. Handlers that see it read from `k8s-snapshot/` instead of running kubectl.

## WebSocket: streaming commands

Long-running commands (`rollout status`, `get events -w`, `wait`, `logs -f`) don't fit request/response. They stream over a native WebSocket. No socket.io anywhere; the server side is the `ws` package.

The server never listens on a separate port. `mountWebSocket()` (`api/routes/execute.ts:280-368`) creates a `WebSocketServer({ noServer: true })` and hooks the shared HTTP server's `upgrade` event, accepting only `req.url === '/api/execute/stream/ws'`. Other upgrades (like HMR) pass through untouched.

There is no POST to start a stream. The first WS message is the start:

```
client                                server
  │  { command, streamId, snapshot }    │
  ├────────────────────────────────────▶│  spawn('kubectl', args)
  │                                     │
  │  { type: 'stream-data',             │
  │    dataType: 'stdout'|'stderr',     │
  │◀────────────────────────────────────┤  ...one per chunk
  │                                     │
  │  { type: 'stream-end',              │
  │    exitCode, fullOutput }           │
  │◀────────────────────────────────────┤  process exited
```

A third type, `stream-error`, covers bad input or spawn failure (`execute.js:269,324`). In snapshot mode the same shape is faked: one `stream-data` then `stream-end` on timers (`execute.js:277-288`).

On the frontend, `WebSocketService.connectStream()` (`src/app/core/services/websocket.service.ts:45`) opens `ws(s)://{host}/api/execute/stream/ws` and fans the three message types out as `data$` / `end$` / `error$`. `KubectlService.executeCommandStream()` (`kubectl.service.ts:189-237`) sits on top; `shouldUseStream()` (`kubectl.service.ts:240-247`) decides which commands take this path instead of `POST /api/execute`.

## kubectl call patterns

The expensive question: how many kubectl processes does one user action cost?

**Graph load — 4 calls.** `fetchLiveData()` (`api/routes/graph.ts:51-96`) reads the graph kinds from `kubelens.config.yaml`, splits built-ins from CRDs, then runs one `kubectl get <all-builtins-joined> -A -o json` plus one call per CRD. The config currently lists 3 graph CRDs (Gateway, HTTPRoute, TCPRoute), so a load is 1 batch + 3 = 4 invocations, all in a single `Promise.all`. Add a graph CRD to the config and the count grows by one. Results are keyed by `group/kind` so same-named Kinds from different groups don't collide (`graph.ts:64-67`).

**Terminal namespace select — 2 phases.** `ResourceTreeService.loadForNamespace()` (`src/app/features/terminal/services/resource-tree.service.ts:85-135`) runs phase 1 as one batch `kubectl get <priority-kinds> -n <ns> -o name` (`KubectlService.getResourceNamesBatch()`, `kubectl.service.ts:250`), renders the tree, then phase 2 fetches every remaining kind in parallel, one call each (`getResourceNames()`, `kubectl.service.ts:281`). Priority kinds show up fast; the long tail fills in behind.

## Export state: disk, not memory

The export panel has four states, and only one of them is a variable the server can set. `paused` is derived from the filesystem on every poll (`snapshot.js:342`): not running, no error, files present, no `.export-complete`. A run killed halfway leaves exactly that, so the panel comes back after a server restart, a browser reload, anything.

The first version of the dismiss button set an in-memory `paused = false` and looked like it worked, for one second. The next poll recomputed from disk and the modal returned. `pausedDismissed` exists to say "the user has seen this and wants past it"; the derived value is ANDed with it, and any new export resets it.

For this backend that directory comes from `snapshotDir()` in `api/utils/paths.ts`: `K8S_SNAPSHOT_PATH` if set, otherwise `<cwd>/k8s-snapshot`. No fallback to the package's own copy, and nothing frozen at import.

Every clause there is a scar. Readers used to fall back to the package while writers did not, so starting the server from `kubelens/api/` sent an export to `kubelens/api/k8s-snapshot` while Snapshot mode kept reading `kubelens/k8s-snapshot` — the panel said "Export complete", the data never changed, and nothing errored. The path used to be a constant read at import; making it lazy without dropping the fallback meant that once `discard` removed the user's directory, the next delete found the package's.

The exporters are separate processes and resolve their own directory, so the export route passes them `K8S_SNAPSHOT_DIR` set to what it just resolved rather than letting them infer it from cwd. Inference matched only while the route's answer was always `<cwd>/k8s-snapshot`; point `K8S_SNAPSHOT_PATH` at `/data/mysnap` and the files landed in `/data/k8s-snapshot` while the route counted `/data/mysnap`. The Go backend has its own copy of this decision in `cmd/server/store/loader.go`, and `cmd/server/routes/snapshot_dir_test.go` is what keeps the two from drifting.

Two dotfiles carry the rest, both written by whichever exporter ran:

```
.export-context    written after the clean, before the first fetch
                   {"context": "<kubectl context>", "startedAt": "<ISO>"}
.export-complete    written when every namespace finished
                   {"context": ..., "exportedAt": ..., "exporter": "bash|node|node-workers|node-procs|go"}
```

They answer different questions and the paused panel needs the first one. "Paused" means `.export-complete` is missing, so the completion marker is never readable in the state that wants it. A fresh export replaces `.export-context`; a resume keeps it, because overwriting would erase the context the panel compares against.

`GET /api/snapshot` returns `snapshotContext` and `currentContext` (the live `kubectl config current-context`), both null unless paused — a running export polls once a second and there is no reason to spawn kubectl that often. The home panel prints both and colours them red when they differ, because resuming then would finish one cluster's export against another and leave both in one directory.

`POST /api/snapshot {"command":"discard"}` deletes the whole directory. That is the only way to get rid of a partial export from the UI.

## Frontend services

Twenty-three services plus one interceptor. Grouped by where they live.

**core/services/** — cross-feature state and transport:

| Service | File | Owns |
|---|---|---|
| `KubectlService` | `kubectl.service.ts:34` | all command execution: POST, stream, batch name fetch, namespaces |
| `WebSocketService` | `websocket.service.ts:34` | one WS per stream; `data$` / `end$` / `error$` |
| `ConfigService` | `config.service.ts:52` | `/api/config` + `/api/api-resources`; kind and template signals |
| `DataModeService` | `data-mode.service.ts:8` | realtime vs snapshot; pings both, persists choice |
| `SnapshotService` | `snapshot.service.ts:33` | export control + 1s progress polling |
| `ThemeService` | `theme.service.ts:14` | theme signal (vestigial — see `theme-system.md`) |
| `VisibilityService` | `visibility.service.ts:14` | per-user kind visibility, keyed `group/Kind` |
| `ExecutionContextService` | `execution-context.service.ts:11` | LIFO group context for command grouping |
| `ExecutionDialogService` | `execution-dialog.service.ts:14` | in-flight executions for the progress dialog |

**features/universe/services/** — `GraphDataService` (`graph-data.service.ts:8`) fetches `/api/graph` and holds nodes/edges/pods/stats signals; `GraphLayoutService` (`graph-layout.service.ts:57`) owns the cosmos WebGL instance.

**features/terminal/services/** — `ResourceTreeService` (`resource-tree.service.ts:21`) builds the per-namespace tree; `PanelManagerService` (`panel-manager.service.ts:35`) persists panels and workspaces; `PanelExecutionService` (`panel-execution.service.ts:35`) runs panel commands, detects mutations, refreshes the tree.

**features/k8s/services/** — `NamespaceService` (`namespace.service.ts:7`), `DeploymentService` (`deployment.service.ts:36`), `RegistryService` (`registry.service.ts:15`).

**features/dashboard/services/** — `YamlParserService`, `UiStateService`, `RolloutService`, `TemplateService`, `OutputParserService`.

**shared/services/** — `ClipboardService`.

## Page-load sequences

**Graph** (route `universe` → `UniverseComponent`, `app.routes.ts:19-24`):

```
UniverseComponent.ngOnInit            universe.component.ts:439
  → DataModeService.refreshAvailability
  → NamespaceService.loadNamespaces
  → GraphDataService.fetchGraph       graph-data.service.ts:25
      → GET /api/graph                (interceptor may add ?snapshot=true)
          → fetchLiveData             1 batch + 3 CRD kubectl calls
          → buildGraph                nodes, edges, pods, stats

ngAfterViewInit                       universe.component.ts:445
  → polls graphData.data() every 100ms
  → initGraph
      → GraphLayoutService.initializeGraph(canvas)   WebGL starts
```

**Terminal** (route `terminal` → `TerminalComponent`, a thin shell; the sidebar drives loading):

```
TerminalSidebarComponent.ngOnInit     terminal-sidebar.component.ts:48
  → DataModeService.refreshAvailability
  → NamespaceService.loadNamespaces
      → KubectlService.getNamespaces  → POST /api/execute

user picks a namespace                terminal-sidebar.component.ts:53
  → PanelManagerService.setNamespaceContext / restoreState
  → ResourceTreeService.loadForNamespace
      → ConfigService.ensureLoaded      → GET /api/config
      → ConfigService.ensureDiscovered  → GET /api/api-resources
      → phase 1: batch priority kinds   → POST /api/execute
      → phase 2: remaining kinds, parallel, one call each

user runs a command in a panel
  → PanelExecutionService.execute     panel-execution.service.ts:45
      → KubectlService.executeCommand        → POST /api/execute
      or executeCommandStream (if shouldUseStream) → WebSocket
```
