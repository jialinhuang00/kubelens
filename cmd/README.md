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

Change one side, change both, then run the tests:

```bash
pnpm run test:go     # go -C cmd/server test ./...
```

`routes/k8s_export_test.go` drives the handlers through `net/http/httptest`, no
cluster needed. It is the only Go test suite so far.
