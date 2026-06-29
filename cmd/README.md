# cmd/ — Go backend (not the default)

Go lives here as an alternative to the Node backend in [`api/`](../api/). Production
runs Node (`tsx api/index.js`); this is a parallel port, kept functional but not the
one that's deployed.

- `cmd/server/` — mirrors `api/`: same HTTP routes (`execute`, `graph`, `config`, …),
  same Snapshot-read logic (`store/`), same graph builder (`graph/`).
- `cmd/k8s-export/` — a standalone export binary. This is the **"go"** option in the
  Export panel's mode picker (the other modes are the scripts in [`scripts/`](../scripts/)).
