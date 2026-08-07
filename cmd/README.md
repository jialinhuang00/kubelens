# cmd/ — Go backend (not the default)

Go lives here as an alternative to the Node backend in [`api/`](../api/). Production
runs Node (`tsx api/index.js`); this is a parallel port, kept functional but not the
one that's deployed.

- `cmd/server/` — mirrors `api/`: same HTTP routes (`execute`, `graph`, `config`,
  `snapshot`, `api-resources`, …), same Snapshot-read logic (`store/`), same graph
  builder (`graph/`). Run it with `pnpm run dev:go`.
- `cmd/k8s-export/` — a standalone export binary. This is the **"go"** option in the
  Export panel's mode picker (the other modes are the scripts in [`scripts/`](../scripts/)).

## Parity is manual, and it drifts quietly

Nothing checks that the two backends agree. Renaming a route on the Node side
leaves this one answering 404 with nothing in the logs: `/api/k8s-export/*` became
`/api/snapshot` on 2026-03-07 and the Go copy kept the old names until 2026-08-07,
so every export button was dead under `dev:go` for five months and no one noticed.
Adding a field to a Node JSON response is the same trap in miniature — Go builds
its response maps by hand, so the field is simply absent until someone adds it.

The quietest version is config that only one side reads. `kubelens.config.yaml`
declares the column layout for seventeen kinds; Node renders all seventeen from
it, and until 2026-08-07 this backend had no struct for that section at all and
seven hand-written table functions instead. `kubectl get secrets` under `dev:go`
came back as a list of names with no TYPE, DATA or AGE, and editing the config
changed nothing here. `store/table.go` is the port. Anything hardcoded here that
Node derives from config is the same bug waiting: `ResourceFileMap` was the
other one, and it had never heard of `daemonsets` or `ingresses`.

Change one side, change both, then run the tests:

```bash
pnpm run test:go      # go -C cmd/server test ./...
pnpm run test:parity  # renders both backends' tables and compares; needs a Go toolchain
```

`routes/k8s_export_test.go` drives the handlers through `net/http/httptest`, no
cluster needed. `routes/exporter_stdout_test.go` feeds them real captured
exporter output. Anything that can only be checked by running both backends
lives in `api/**/*.itest.ts` instead, because half of it is TypeScript.
