# kubecmds-viz Project Context

## Architecture
- Angular 20+ standalone components with signals
- Express.js backend (`server.js` + `routes/`)
- TypeScript with strict compilation
- Soft Gold cyberpunk theme (`#e8b866` accent on `#0e0b08` background)
- Dual data mode: **Realtime** (live kubectl) and **Snapshot** (offline `k8s-snapshot/`)

## Key Patterns
- `inject()` pattern (no constructor DI)
- `DestroyRef` + `takeUntilDestroyed()` for subscription cleanup
- `execFile` instead of `exec` to prevent shell injection
- `fs.promises` (async) for all file I/O in polled endpoints
- Snapshot mode: per-request `?snapshot=true` via HTTP interceptor

## File Structure
```
├── server.js                  # Express entry point
├── routes/                    # API route handlers
│   ├── execute.js             #   POST /api/execute — run kubectl
│   ├── graph.js               #   GET  /api/graph — resource topology
│   ├── k8s-export.js          #   /api/k8s-export/* — export control + progress
│   ├── resource-counts.js     #   GET  /api/resource-counts
│   ├── status.js              #   GET  /api/realtime/ping, /api/snapshot/ping
│   └── ecr.js                 #   ECR image endpoints
├── utils/
│   ├── snapshot-handler.js    #   Re-export shim + getResourceCounts
│   ├── snapshot-loader.js     #   Constants, cache, YAML/text file loading
│   ├── snapshot-parsers.js    #   Table generators, describe generators, helpers
│   ├── snapshot-commands.js   #   Command parser + all kubectl action handlers
│   └── graph-builder.js       #   Graph construction logic (buildGraph, extractWorkloadEdges)
├── scripts/                   # CLI tools (bash 3.2 compatible)
│   ├── k8s-export.sh          #   Parallel batched cluster export
│   ├── split-resources.js     #   Splits kubectl JSON into per-kind YAML files
│   └── kind-map.json          #   Kind → filename mapping
├── src/app/
│   ├── core/services/         #   kubectl, data-mode, k8s-export, websocket, execution-context
│   └── features/
│       ├── home/              #   Landing page — mode toggle, export UI
│       ├── dashboard/         #   Command execution terminal (executor service extracted)
│       ├── universe/          #   GPU-accelerated graph (@cosmograph/cosmos)
│       └── k8s/               #   K8s resource views
└── k8s-snapshot/              # Exported cluster data (gitignored)
```

## Data Flow

### Realtime Mode
Frontend → `routes/execute.js` → `execFile('kubectl', ...)` → live cluster

### Snapshot Mode
Frontend → `routes/execute.js` → `snapshot-handler.js` → reads `k8s-snapshot/*.yaml`

### Export
Home page → `routes/k8s-export.js` → spawns `scripts/k8s-export.sh` → writes `k8s-snapshot/`
- 4 parallel resource batches + CRD batch + 2 pod txt files per namespace
- Progress streamed via stdout parsing, polled by frontend every 1s
- `.export-complete` marker = snapshot available

## Development Commands
- `npm run dev` — Start frontend (4200) + backend (3000)
- `bash scripts/k8s-export.sh` — CLI export (independent of server)
- `bash scripts/k8s-export.sh --resume` — Resume interrupted export
- `ng build` — Production build
- `ng test` — Unit tests

## Important Constraints
- bash scripts must work on macOS bash 3.2 (no `declare -A`, empty arrays + `set -u` crash)
- `snapshot-loader.js` uses in-memory cache — only blocks on first call per resource
- Snapshot dependencies: `parsers` → `loader`, `commands` → `loader` + `parsers`, `handler` → `loader` + `commands`
- Build warnings for regl/seedrandom CommonJS modules are expected (cosmos dependency)
- Graph endpoint runs 9 parallel kubectl calls in realtime mode
