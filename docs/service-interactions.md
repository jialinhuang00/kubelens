# Service Interactions

User opens a page. What happens next?

---

## Graph: Page Load

The user hits `/universe`. Three things fire. One HTTP call. One WebGL canvas. Done.

```mermaid
sequenceDiagram
    participant U as User
    participant UC as UniverseComponent
    participant GDS as GraphDataService
    participant INT as SnapshotInterceptor
    participant DMS as DataModeService
    participant API as routes/graph.js
    participant GB as graph-builder.ts
    participant SL as snapshot-loader.ts
    participant KC as kubectl
    participant GLS as GraphLayoutService
    participant COS as Cosmos WebGL

    U->>UC: navigate /universe
    UC->>GDS: fetchGraph()
    GDS->>INT: GET /api/graph
    INT->>DMS: isSnapshotMode()?

    alt Snapshot mode
        INT->>API: GET /api/graph?snapshot=true
        API->>GB: buildGraph(getItemsFn, namespaces)
        GB->>SL: load YAML from k8s-snapshot/
        SL-->>GB: parsed K8s items
    else Realtime mode
        INT->>API: GET /api/graph
        API->>KC: 9 parallel kubectl calls
        KC-->>API: JSON responses
        API->>GB: buildGraph(getItemsFn, namespaces)
    end

    GB-->>API: { nodes, edges, pods, stats }
    API-->>GDS: GraphDataResponse
    GDS-->>UC: data signal updated

    UC->>GLS: initializeGraph(canvas, data)
    GLS->>GLS: buildCosmosData() — position nodes in rings
    GLS->>COS: new Graph(canvas, config)
    GLS->>COS: setData(nodes, links)
    GLS->>GLS: startLabelLoop() — 20fps RAF
    GLS-->>UC: onLabelsUpdate(labels, boundaries)
```

6 services touched. 1 HTTP call. Graph renders in one shot.

---

## Terminal: Page Load

The user hits `/dashboard`. Two checks fire in parallel. Then namespaces load. Nothing else until the user picks one.

```mermaid
sequenceDiagram
    participant U as User
    participant DC as DashboardComponent
    participant DMS as DataModeService
    participant KES as K8sExportService
    participant NS as NamespaceService
    participant KS as KubectlService
    participant EDS as ExecutionDialogService
    participant INT as SnapshotInterceptor
    participant API as routes/execute.js
    participant ST as routes/status.js

    U->>DC: navigate /dashboard
    DC->>DMS: checkAvailability()

    par Ping both modes
        DMS->>ST: GET /api/realtime/ping
        ST-->>DMS: { status, kubectl.version }
        DMS->>ST: GET /api/snapshot/ping
        ST-->>DMS: { available: true/false }
    end

    DMS->>DMS: auto-select mode (prefer realtime)

    DC->>NS: loadNamespaces()
    NS->>KS: getNamespaces()
    KS->>EDS: addExecution() — track command
    KS->>INT: POST /api/execute
    INT->>DMS: isSnapshotMode()?
    INT->>API: POST /api/execute (+?snapshot=true if needed)
    API-->>KS: { success, stdout: "ns1 ns2 ns3" }
    KS->>EDS: updateExecution(completed)
    KS-->>NS: namespace list
    NS-->>DC: namespaces signal updated
    DC-->>U: namespace dropdown ready
```

3 HTTP calls. Dashboard waits for user input.

---

## Terminal: Namespace Selected

The user picks a namespace. Three resource fetches fire in parallel. Generic resources wait until expanded.

```mermaid
sequenceDiagram
    participant U as User
    participant DC as DashboardComponent
    participant ECS as ExecutionContextService
    participant DS as DeploymentService
    participant PS as PodService
    participant SS as SvcService
    participant KS as KubectlService
    participant API as routes/execute.js
    participant GRS as GenericResourceService

    U->>DC: select namespace
    DC->>ECS: withGroup("namespaceResourceLoading")

    par Load 3 resource types + counts
        DC->>KS: getResourceCounts(ns)
        KS->>API: GET /api/resource-counts?namespace=ns
        API-->>DC: { deployments: 5, pods: 12, services: 3 }

        DC->>DS: loadDeployments(ns)
        DS->>KS: getResourceNames("deployments", ns)
        KS->>API: POST /api/execute
        API-->>DS: deployment names

        DC->>PS: loadPods(ns)
        PS->>KS: getResourceNames("pods", ns)
        KS->>API: POST /api/execute
        API-->>PS: pod names

        DC->>SS: loadServices(ns)
        SS->>KS: getResourceNames("services", ns)
        KS->>API: POST /api/execute
        API-->>SS: service names
    end

    DC-->>U: dropdowns populated

    U->>DC: expand ConfigMaps panel
    DC->>GRS: loadResource("configmaps", ns)
    GRS->>KS: getResourceNames("configmaps", ns)
    KS->>API: POST /api/execute
    API-->>GRS: configmap names
    GRS-->>DC: items signal updated
```

4 parallel HTTP calls on namespace select. Generic resources load on demand.

---

## Terminal: Command Execution

The user runs a command. Two paths: normal (single response) or streaming (long-running).

```mermaid
sequenceDiagram
    participant U as User
    participant DC as DashboardComponent
    participant DES as DashboardExecutorService
    participant ECS as ExecutionContextService
    participant KS as KubectlService
    participant EDS as ExecutionDialogService
    participant WSS as WebSocketService
    participant OPS as OutputParserService
    participant API as routes/execute.js
    participant SH as snapshot-handler.ts
    participant KC as kubectl

    U->>DC: run command

    alt Normal command
        DC->>DES: executeNormal(cmd, group)
        DES->>ECS: withGroup(group)
        DES->>KS: executeCommand(cmd)
        KS->>EDS: addExecution()
        KS->>API: POST /api/execute

        alt Snapshot mode
            API->>SH: handleCommand(cmd)
            SH-->>API: { success, stdout }
        else Realtime mode
            API->>KC: execFile("kubectl", args)
            KC-->>API: stdout/stderr
        end

        API-->>KS: response
        KS->>EDS: updateExecution(completed)
        KS-->>DES: KubectlResponse
        DES-->>DC: { response }

    else Streaming command (logs -f, rollout status)
        DC->>DES: executeStream(cmd)
        DES->>KS: executeCommandStream(cmd)
        KS->>API: POST /api/execute/stream
        API->>KC: spawn("kubectl", args)
        KC-->>API: stdout chunks
        API-->>WSS: socket.io "stream-data"
        WSS-->>KS: stream data
        KS-->>DC: output$ observable (chunks)
    end

    DC->>OPS: parseCommandOutput(stdout, cmd)
    OPS-->>DC: { type: "table"|"yaml"|"raw", data }
    DC-->>U: rendered output
```

---

## Service Responsibilities

Each service does one thing.

### Graph feature

| Service | One-line job |
|---------|-------------|
| **GraphDataService** | Fetches `/api/graph`, caches response in signals |
| **GraphLayoutService** | Positions nodes in rings, drives Cosmos WebGL, tracks labels at 20fps |

### Terminal feature

| Service | One-line job |
|---------|-------------|
| **DashboardExecutorService** | Wraps command execution with context group and cancellation |
| **KubectlService** | Sends commands to backend, tracks each in ExecutionDialog |
| **ExecutionContextService** | LIFO stack — tags commands with a group name for batch cancellation |
| **ExecutionDialogService** | Tracks in-flight commands, shows progress, auto-hides on completion |
| **WebSocketService** | Socket.io client — routes stream chunks by streamId |
| **OutputParserService** | Detects output type (table, YAML, raw, events) from stdout |
| **TemplateService** | Generates kubectl command templates per resource type |
| **UiStateService** | Tracks which output sections are expanded/collapsed |
| **NamespaceService** | Loads and holds the namespace list |
| **DeploymentService** | Loads deployments, fetches status JSON, streams rollout status |
| **PodService** | Loads pod names for a namespace |
| **SvcService** | Loads service names for a namespace |
| **GenericResourceService** | Lazy-loads any other resource type on demand |
| **RolloutService** | Builds and executes rollout commands (restart, undo, set image) |
| **RolloutStateService** | Coordinates rollout actions — executes, waits 1s, refreshes status |
| **EcrService** | Fetches ECR image tags for deployment upgrades |

### Shared

| Service | One-line job |
|---------|-------------|
| **DataModeService** | Decides realtime vs snapshot — pings both, auto-selects |
| **K8sExportService** | Controls export lifecycle — start, pause, poll progress every 1s |
| **SnapshotInterceptor** | Adds `?snapshot=true` to every `/api/` request when in snapshot mode |
| **snapshot-loader.ts** | Reads YAML from `k8s-snapshot/`, caches in memory, blocks only on first load |
| **routes/status.js** | Two endpoints — `/api/realtime/ping` and `/api/snapshot/ping` |
