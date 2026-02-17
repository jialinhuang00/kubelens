# kubecmds-viz

Kubernetes cluster visualization and management tool. Angular frontend + Express backend that supports both **realtime** (live kubectl) and **snapshot** (offline export) modes.

## Quick Start

```bash
npm run dev
```

Opens at `http://localhost:4200`. Backend runs on port 3000.

## Data Modes

- **Realtime** — executes kubectl commands against a live cluster
- **Snapshot** — reads from `k8s-snapshot/` directory (exported via the home page or `scripts/k8s-export.sh`)

The home page auto-detects available modes and lets you toggle between them.

## Project Structure

```
├── server.js                  # Express entry point — middleware, route mounting
├── routes/                    # API route handlers
│   ├── execute.js             #   POST /api/execute — run kubectl commands
│   ├── graph.js               #   GET  /api/graph — resource topology (nodes + edges)
│   ├── k8s-export.js          #   POST/GET /api/k8s-export/* — snapshot export control + progress
│   ├── resource-counts.js     #   GET  /api/resource-counts — per-namespace resource counts
│   ├── status.js              #   GET  /api/realtime/ping, /api/snapshot/ping
│   └── ecr.js                 #   ECR image-related endpoints
├── utils/
│   ├── snapshot-handler.js    #   Re-export shim + getResourceCounts
│   ├── snapshot-loader.js     #   Constants, cache, YAML/text file loading
│   ├── snapshot-parsers.js    #   Table generators, describe generators, helpers
│   ├── snapshot-commands.js   #   Command parser + all kubectl action handlers
│   └── graph-builder.js       #   Graph construction logic (buildGraph, extractWorkloadEdges)
├── scripts/                   # CLI tools (bash + node)
│   ├── k8s-export.sh          #   Dump cluster resources to k8s-snapshot/ (parallel batched kubectl)
│   ├── split-resources.js     #   Splits combined kubectl JSON output into per-kind YAML files
│   └── kind-map.json          #   Kind → filename mapping for split-resources.js
├── src/app/                   # Angular frontend
│   ├── core/services/         #   Shared services (kubectl, data-mode, export, websocket)
│   └── features/
│       ├── home/              #   Landing page — mode toggle, snapshot export UI
│       ├── dashboard/         #   Command execution terminal
│       ├── universe/          #   GPU-accelerated resource graph (@cosmograph/cosmos)
│       └── k8s/               #   K8s resource views
└── k8s-snapshot/              # Exported cluster data (gitignored)
```

### routes/

Express API handlers, each file exports a router mounted by `server.js`.

| File | Endpoints | Description |
|------|-----------|-------------|
| `execute.js` | `POST /api/execute` | Runs kubectl commands, supports streaming via WebSocket |
| `graph.js` | `GET /api/graph` | Route handler + `fetchLiveData`; graph logic delegated to `utils/graph-builder.js` |
| `k8s-export.js` | `POST /api/k8s-export/start`, `GET .../progress`, `POST .../stop` | Spawns `k8s-export.sh`, streams progress via stdout parsing |
| `resource-counts.js` | `GET /api/resource-counts` | Counts resources per namespace (parallel `execFile`, no shell injection) |
| `status.js` | `GET /api/realtime/ping`, `GET /api/snapshot/ping` | Kubectl availability check and snapshot completeness check |
| `ecr.js` | `GET /api/ecr/*` | ECR image listing and profile mapping |

### utils/

Snapshot dependencies: `parsers` → `loader`, `commands` → `loader` + `parsers`, `handler` → `loader` + `commands`

| File | Description |
|------|-------------|
| `snapshot-loader.js` | Constants (`BACKUP_PATH`, `DEFAULT_NAMESPACE`), in-memory cache, YAML/text file loading |
| `snapshot-parsers.js` | Helpers (`pad`, `getAge`), table generators (deployment, service, etc.), describe generators |
| `snapshot-commands.js` | `parseKubectlCommand` parser, `handleCommand` dispatcher, all action sub-handlers |
| `snapshot-handler.js` | Re-export shim: re-exports `handleCommand`/`parseKubectlCommand`, owns `getResourceCounts` |
| `graph-builder.js` | Pure graph logic: `discoverNamespaces`, `buildGraph`, `extractWorkloadEdges` (no Express) |

### scripts/

CLI tools for cluster data export. Designed for macOS (bash 3.2 compatible).

| File | Description |
|------|-------------|
| `k8s-export.sh` | Main export script. Discovers namespaces, fetches resources in 4 parallel batches per namespace, supports `--resume` and `--cluster-scoped` |
| `split-resources.js` | Node helper piped from kubectl. Reads combined JSON from stdin, splits by Kind, writes per-kind `.yaml` files |
| `kind-map.json` | Maps Kubernetes Kind names (e.g. `Deployment`) to filenames (e.g. `deployments`) |

Export batches per namespace:
1. `pods` — usually the most objects
2. `deployments,statefulsets,daemonsets,cronjobs,jobs` — core workloads
3. `configmaps,secrets,serviceaccounts,persistentvolumeclaims,roles,rolebindings` — config & auth
4. `services,ingresses,endpoints,networkpolicies,horizontalpodautoscalers,poddisruptionbudgets` — networking & scaling
5. CRD resources (if available): gateways, httproutes, tcproutes
6. `pods-snapshot.txt` — `kubectl get pods -o wide`
7. `pods-images.txt` — pod-to-image mapping

## Development

```bash
npm run dev          # Start frontend + backend
ng build             # Production build → dist/
ng test              # Unit tests (Karma)
```

### Optional: Test Cluster

```bash
bash scripts/cluster-setup.sh   # Create kind cluster with test services
bash scripts/cleanup.sh          # Remove cluster
```

## Tech Stack

- **Frontend**: Angular 20+, standalone components, signals, `@cosmograph/cosmos` (WebGL graph)
- **Backend**: Express.js, `child_process.execFile` (no shell injection)
- **Theme**: Soft Gold cyberpunk — `#e8b866` accent on `#0e0b08` background
