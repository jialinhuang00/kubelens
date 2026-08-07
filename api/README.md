# api/ — Node.js backend (the one that runs)

Express server, TypeScript throughout. `pnpm run dev` runs the sources through
tsx (`tsx api/index.ts`); the published package runs the `.js` that
`build:server` compiles beside each of them.
The Go backend in [`cmd/`](../cmd/) is a parallel port — this is the real one.

- `index.js` — entry point.
- `routes/` — one file per HTTP endpoint (`/api/execute`, `/api/graph`, `/api/config`, …).
- `utils/` — the logic.

Two snapshot concerns live in `utils/`, don't confuse them:

- **Snapshot read** (`snapshot-handler` / `loader` / `parsers` / `commands`.ts) —
  Snapshot mode: read `k8s-snapshot/*.yaml` and fake kubectl output.
- Everything else — `config-loader`, `graph-builder`, `api-resources`, `init-detect`.

Snapshot **export** (writing those files) is NOT here — it's in [`scripts/`](../scripts/).

## Tests

`pnpm run test:utils` runs `utils/**/*.spec.ts` and `routes/**/*.spec.ts`.

`routes/snapshot.spec.ts` is the only route spec so far: a real Express app on an
ephemeral port, driven with Node's built-in `fetch`, no mocks. It covers the
export state machine (paused derived from disk, dismissal, discard, the recorded
cluster context). It cannot cover `command: 'start'` — every mode spawns a real
exporter against the live kubeconfig, which is not something a unit test should
do. The Go port avoids that by keeping the mode-to-command mapping in a pure
function (`exporterCommand`); doing the same here would make it testable.

`snapshot.js` resolves its snapshot directory once at require time from
`process.cwd()`, so the spec chdirs into a temp directory *before* requiring the
module. `node --test` runs each spec file in its own process, so that chdir does
not reach the other specs.
