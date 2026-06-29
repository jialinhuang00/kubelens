# scripts/ — snapshot export + CLI tools

Snapshot **export** writes your live cluster out to `k8s-snapshot/`. There are
several implementations on purpose — they're the comparison set behind the in-app
**benchmark** feature (which export strategy is fastest), not redundant copies:

- `snapshot-bash.sh` — bash, parallel batched
- `snapshot-node.js` — node, sequential
- `snapshot-node-workers.js` — node, `worker_threads`
- `snapshot-node-procs.js` — node, `child_process`

(a Go export mode lives in [`cmd/k8s-export/`](../cmd/k8s-export/))

Other tools:

- `split-resources.js` — splits one kubectl JSON dump into per-kind YAML files.
- `init.ts` — `pnpm run init`: generates `kubelens.config.yaml` for your cluster.
- `kind-map.json` — Kind → filename mapping.

Export (write) is not the same as Snapshot **read** — the read side (serve those
files back as fake kubectl output) lives in `api/utils/snapshot-*`.
