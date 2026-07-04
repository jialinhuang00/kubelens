# Data Flow

Who calls whom, from a click in the browser down to `kubectl`. Read this before touching `api/routes/` or any frontend service.

Two backends live in this repo. The Node backend (`api/index.js`, Express 5) is what `npm run dev` runs and what this doc describes. The Go backend under `cmd/server/` is a parallel implementation and not covered here.

## HTTP endpoints

All routers mount under `/api` (`api/index.js:36-42`). In prod, anything outside `/api/` falls through to the SPA's `index.html` (`api/index.js:51`).

| Method | Path | Handler | Returns |
|---|---|---|---|
| GET | `/api/graph` | `api/routes/graph.js:85` | `{nodes, edges, pods, namespaces, stats}` |
| POST | `/api/execute` | `api/routes/execute.js:161` | `{success, stdout, command}`; one kubectl run |
| POST | `/api/execute/stream/stop` | `api/routes/execute.js:219` | kills a stream's process by `streamId` |
| POST | `/api/execute/stream/clear` | `api/routes/execute.js:236` | clears a stream's buffer |
| GET | `/api/config` | `api/routes/config.js:8` | `{resources, templates}` from `kubelens.config.yaml` |
| GET | `/api/api-resources` | `api/routes/discovery.js:23` | discovered kinds from `kubectl api-resources` |
| GET | `/api/registry/tags` | `api/routes/registry.js:114` | image tags; detects ECR/GAR/GCR/ACR from `?image=` |
| POST | `/api/snapshot` | `api/routes/snapshot.js:64` | export control: `start` / `stop` / `clear` |
| GET | `/api/snapshot` | `api/routes/snapshot.js:259` | export progress (running, totals, ETA) |
| GET | `/api/realtime/ping` | `api/routes/status.js:13` | kubectl health + version |
| GET | `/api/export/ping` | `api/routes/status.js:56` | is GNU `parallel` installed |
| GET | `/api/snapshot/ping` | `api/routes/status.js:66` | does `k8s-snapshot/.export-complete` exist |
| GET | `/api/debug/memory` | `api/index.js:18` | rss / heap in MB |

Every `/api/` request can carry `?snapshot=true`. The frontend never adds it by hand: `snapshotInterceptor` (`src/app/core/interceptors/snapshot.interceptor.ts:10`) appends it to all `/api/` calls while snapshot mode is on. Handlers that see it read from `k8s-snapshot/` instead of running kubectl.

## WebSocket: streaming commands

Long-running commands (`rollout status`, `get events -w`, `wait`, `logs -f`) don't fit request/response. They stream over a native WebSocket. No socket.io anywhere; the server side is the `ws` package.

The server never listens on a separate port. `mountWebSocket()` (`api/routes/execute.js:244-330`) creates a `WebSocketServer({ noServer: true })` and hooks the shared HTTP server's `upgrade` event, accepting only `req.url === '/api/execute/stream/ws'`. Other upgrades (like HMR) pass through untouched.

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

**Graph load — 4 calls.** `fetchLiveData()` (`api/routes/graph.js:37-82`) reads the graph kinds from `kubelens.config.yaml`, splits built-ins from CRDs, then runs one `kubectl get <all-builtins-joined> -A -o json` plus one call per CRD. The config currently lists 3 graph CRDs (Gateway, HTTPRoute, TCPRoute), so a load is 1 batch + 3 = 4 invocations, all in a single `Promise.all`. Add a graph CRD to the config and the count grows by one. Results are keyed by `group/kind` so same-named Kinds from different groups don't collide (`graph.js:49-52`).

**Terminal namespace select — 2 phases.** `ResourceTreeService.loadForNamespace()` (`src/app/features/terminal/services/resource-tree.service.ts:85-135`) runs phase 1 as one batch `kubectl get <priority-kinds> -n <ns> -o name` (`KubectlService.getResourceNamesBatch()`, `kubectl.service.ts:250`), renders the tree, then phase 2 fetches every remaining kind in parallel, one call each (`getResourceNames()`, `kubectl.service.ts:281`). Priority kinds show up fast; the long tail fills in behind.

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
