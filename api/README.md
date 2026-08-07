# api/ — Node.js backend (the one that runs)

Express server. Both `pnpm run dev` and production run this (`tsx api/index.js`).
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

`pnpm run test:utils` covers `utils/` only. Nothing in `routes/` has a test, so
changes to export control, the paused state or the SPA fallback are verified by
hand. The Go port has route tests (`pnpm run test:go`) if you want a reference for
what the same coverage would look like here.
