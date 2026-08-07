# scripts/ — snapshot export + CLI tools

Snapshot **export** writes your live cluster out to `k8s-snapshot/`. There are
several implementations on purpose — they're the comparison set behind the in-app
**benchmark** feature (which export strategy is fastest), not redundant copies:

- `snapshot-bash.sh` — bash, parallel batched
- `snapshot-node.js` — node, sequential
- `snapshot-node-workers.js` — node, `worker_threads`
- `snapshot-node-procs.js` — node, `child_process`

(a Go export mode lives in [`cmd/k8s-export/`](../cmd/k8s-export/))

## Every exporter writes the same two dotfiles

All five implementations produce an interchangeable `k8s-snapshot/`, which means
five copies of this, and a missed one is invisible until someone runs that mode:

```
.export-context    after the clean, before the first fetch
                   {"context": "<kubectl context>", "startedAt": "<ISO>"}
                   fresh export overwrites; --resume keeps what is there
.export-complete   after the last namespace
                   {"context": ..., "exportedAt": ..., "exporter": "bash|node|node-workers|node-procs|go"}
```

The app reads them to answer two questions a snapshot directory cannot answer on
its own: did this finish, and which cluster is it from. Miss `.export-context` in
one exporter and the paused panel just shows nothing for snapshots that mode made.
The exporters all know the name already (they print `Cluster context:` on startup)
so it is a write, not a lookup.

The same five-way duplication applies to the kind list: bash `NS_BATCHES`, the
three node `NS_BATCHES`, and Go `nsBatches` (plus `kind-map.json` / `kindmap.go`
for filenames).

Other tools:

- `split-resources.js` — splits one kubectl JSON dump into per-kind YAML files.
- `init.ts` — `pnpm run init`: generates `kubelens.config.yaml` for your cluster.
- `kind-map.json` — Kind → filename mapping.

Export (write) is not the same as Snapshot **read** — the read side (serve those
files back as fake kubectl output) lives in `api/utils/snapshot-*`.
