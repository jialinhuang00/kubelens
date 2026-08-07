# api/ — Node.js backend (the one that runs)

Express server, TypeScript throughout. `pnpm run dev` runs the sources through
tsx (`tsx api/index.ts`); the published package runs the `.js` that
`build:server` compiles beside each of them.
The Go backend in [`cmd/`](../cmd/) is a parallel port — this is the real one.

- `index.ts` — entry point.
- `routes/` — one file per HTTP endpoint (`/api/execute`, `/api/graph`, `/api/config`, …).
- `utils/` — the logic.

Two snapshot concerns live in `utils/`, don't confuse them:

- **Snapshot read** (`snapshot-handler` / `loader` / `parsers` / `commands`.ts) —
  Snapshot mode: read `k8s-snapshot/*.yaml` and fake kubectl output.
- Everything else — `config-loader`, `graph-builder`, `api-resources`, `init-detect`.

Snapshot **export** (writing those files) is NOT here — it's in [`scripts/`](../scripts/).

## Tests

`pnpm run test:utils` runs `utils/**/*.spec.ts` and `routes/**/*.spec.ts`, and
makes no external calls at all. `pnpm run test:parity` runs `**/*.itest.ts`,
which does the opposite on purpose: it starts a real exporter and a real `go
run` to check that every implementation resolves the same snapshot directory,
and recaptures every exporter's stdout to check the committed samples still
match. Two scripts because "this suite touches nothing" is only useful if it
stays true.

`pnpm run test:types` is separate from both. tsx runs the specs without checking
types, so a green suite says nothing about whether the code compiles.

Two suites read files instead of keeping their own copy of what another file
says: `export-failure.spec.ts` renders the abort message out of
`scripts/snapshot-bash.sh`, and `export-progress.spec.ts` reads captured
exporter stdout from `test-fixtures/exporter-stdout/`. Both replaced hand-typed
samples that had gone stale without anything failing. `*.fixture.ts` is the
suffix for helpers that exist only for tests; `tsconfig.publish.json` excludes
the pattern, so they stay out of the package.

`routes/snapshot.spec.ts` is the only route spec so far: a real Express app on an
ephemeral port, driven with Node's built-in `fetch`, no mocks. It covers the
export state machine (paused derived from disk, dismissal, discard, the recorded
cluster context). It cannot cover `command: 'start'` — every mode spawns a real
exporter against the live kubeconfig, which is not something a unit test should
do. The Go port avoids that by keeping the mode-to-command mapping in a pure
function (`exporterCommand`); doing the same here would make it testable.

`snapshot.ts` resolves its snapshot directory per call through `snapshotDir()`,
so the spec points `K8S_SNAPSHOT_PATH` at a temp directory and asks the route
for its own `fileCount` before running anything. It used to resolve once at
require time from `process.cwd()`, which meant a spec could only redirect it by
chdir-ing before the import — and getting that order wrong deleted the repo's
real snapshot.
