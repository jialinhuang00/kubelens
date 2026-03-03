# kubecmds-viz

Browser-based Kubernetes visualization. GPU-accelerated resource graph + multi-window kubectl terminal. Runs against a live cluster or offline from exported snapshots.

![K8s Universe — resource topology graph](./docs/01-universe-overview.png)

![K8s Terminal — multi-window kubectl interface](./docs/03-terminal.png)

## Prerequisites

- Node.js 18+
- `kubectl` configured with a valid kubeconfig (required for Realtime mode)
- Snapshot mode works offline — no cluster needed

Optional:
- `aws` CLI — only needed for ECR image tag lookups
- `ECR_PROFILE_MAP` in `.env` — maps AWS account IDs to SSO profile names. Copy `.env.example` to get started.

## Quick Start

```bash
npm install
npm run dev
```

Frontend at `http://localhost:4200`. Backend at port 3000.

## Modes

- **Realtime** — runs kubectl against a live cluster
- **Snapshot** — reads from `k8s-snapshot/` (export via home page or `bash scripts/k8s-export.sh`)

## Dev

```bash
npm run dev       # frontend + backend
ng build          # production build
ng test           # unit tests
```

## Stack

- Angular 20+, signals, standalone components
- `@cosmograph/cosmos` — WebGL force-directed graph
- Express.js, `execFile` (no shell injection)
