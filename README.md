# kubelens

Browser-based Kubernetes visualization. GPU-accelerated resource graph + multi-window kubectl terminal. Runs against a live cluster or offline from exported snapshots.

![K8s Universe — resource topology graph with a selected resource's relationships](./docs/02-universe-target-ns.png)

![K8s Terminal — drag a resource window onto another desktop to move it](./docs/03-terminal.gif)

## Prerequisites

- Node.js 18+
- pnpm (the repo ships a `pnpm-lock.yaml`; install with `npm i -g pnpm` or via Corepack)
- `kubectl` configured with a valid kubeconfig (required for Realtime mode)
- Snapshot mode works offline — no cluster needed

Optional (only for image tag lookups in the rollout panel):
- `aws` CLI for ECR, `gcloud` for Artifact Registry / GCR, `az` for ACR — the registry is detected from the image URL
- `ECR_PROFILE_MAP` in `.env` — maps AWS account IDs to SSO profile names (ECR only). Copy `.env.example` to get started.

## Quick Start

You need `kubectl` already pointed at a cluster (see Prerequisites).

```bash
pnpm install
pnpm run dev
```

Frontend at `http://localhost:4200`, backend at port 3042. The landing page is where you pick a mode and, for offline use, export a snapshot.

No cluster to point at? [`examples/`](./examples/README.md) spins up a throwaway
[kind](https://kind.sigs.k8s.io/) cluster with a small 3-service demo app, so you
have something real to explore in a couple of commands.

## Modes

- **Realtime** — runs kubectl against your live cluster (the default).
- **Snapshot** — reads exported YAML from `k8s-snapshot/`. Create one from the landing page **Export** panel, then switch to Snapshot mode; no cluster needed after that. (`scripts/snapshot-bash.sh` does the same from the CLI if you prefer.)

## Configuration

Everything the app shows is driven by config, not hardcoded. The committed config works out of the box; it's also where you customize.

Two files, clear roles:

- **`kubelens.config.yaml`** — the only file the app reads (at startup, via `/api/config`). Edit it directly to customize your setup.
- **`kubelens.default.yaml`** — a neutral seed (built-in kinds, no CRDs) that `init` builds from. Never read at runtime.

Fit it to your own cluster:

```bash
pnpm run init              # detect cluster + registry + CRDs → kubelens.config.yaml
pnpm run init -- --merge   # later: refresh CRDs, keep your edits
```

`init` reads the seed, infers cluster type and image registry from kubeconfig/images, lists your CRDs via `kubectl api-resources`, and writes a complete config. Discovered CRDs ship off — enable them in the in-app visibility panel. (Edit the seed and re-run `init` to change the shipped defaults; edit `config.yaml` for a one-off.)

Three sections are customizable, all hand-editable:

**Kinds** (`resources`) — which kinds appear in the tree and graph:

```yaml
resources:
  - { kind: VirtualService, key: virtualservices, resourceType: virtualservices.networking.istio.io,
      namePrefix: virtualservice.networking.istio.io, group: networking.istio.io,
      label: VirtualServices, color: '#7a9eaa', show: [tree], default: [] }
```

- `show` — capability: which views this kind *can* appear in (`tree`, `graph`).
- `default` — default-on views (subset of `show`); omit to default to `show`. `default: []` ships a kind capable-but-off; it appears in the visibility panel to switch on.

**Panel commands** (`templates`) — the buttons on each resource window, keyed by Kind. `{name}` / `{namespace}` resolve at run time:

```yaml
templates:
  Pod:
    - { name: Logs, command: "kubectl logs {name} -n {namespace} --tail=50 -f" }
    - { name: Delete, command: "kubectl delete pod {name} -n {namespace}" }
```

Flags: `requiresInput` (populate an editable command instead of running it), `disabled` (greyed out).

**Snapshot tables** (`tables`) — column layout for `kubectl get` output in Snapshot mode, keyed by Kind. `value` is a template: `{.path}` reads a field, `{.path|age}` runs a transform, `{...?fallback}` defaults when empty:

```yaml
tables:
  Deployment:
    columns:
      - { name: NAME,  value: "{.metadata.name}", width: 38 }
      - { name: READY, value: "{.status.readyReplicas?0}/{.spec.replicas?1}", width: 8 }
      - { name: AGE,   value: "{.metadata.creationTimestamp|age}" }
```

See the `tables:` comment in `kubelens.default.yaml` for the full transform list.

## Dev

```bash
pnpm run dev      # frontend + backend
pnpm run build    # production build
pnpm test         # unit tests
```

## Stack

- Angular 20+, signals, standalone components
- `@cosmograph/cosmos` — WebGL force-directed graph
- Express.js, `execFile` (no shell injection)
