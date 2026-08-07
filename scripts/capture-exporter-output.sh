#!/usr/bin/env bash
# Captures one namespace's worth of stdout from every exporter, so the two
# backends' progress parsers can be tested against what the exporters really
# print instead of against a sample somebody typed.
#
# Both backends parse this stdout with hand-written regexes, and both were wrong
# about it: bash padded its namespace tag inside the brackets ("[demo    ]")
# where the other four padded outside ("[demo]    "), so the Node route matched
# four of five; the Go route had no tag in its patterns at all and matched none.
# Nothing caught it because the tests fed the parsers hand-typed lines.
#
# Usage: bash scripts/capture-exporter-output.sh [outdir] [namespace]
#   outdir    defaults to test-fixtures/exporter-stdout
#   namespace defaults to the first namespace kubectl reports
#
# Needs a reachable cluster and a Go toolchain. Writes <mode>.txt per exporter.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/test-fixtures/exporter-stdout}"
NS="${2:-}"

if ! kubectl config current-context >/dev/null 2>&1; then
  echo "no reachable cluster — nothing captured" >&2
  exit 2
fi
if [[ -z "$NS" ]]; then
  NS=$(kubectl get ns --no-headers -o custom-columns=:.metadata.name 2>/dev/null | head -1)
fi
if [[ -z "$NS" ]]; then
  echo "cluster has no namespaces — nothing captured" >&2
  exit 2
fi

mkdir -p "$OUT"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "capturing namespace '$NS' into $OUT"

capture() {
  local mode="$1"; shift
  local dir="$WORK/$mode"
  mkdir -p "$dir"
  # Each exporter gets its own directory so the cross-cluster guard and the
  # resume markers from one run never reach the next.
  if K8S_SNAPSHOT_PATH="$dir" "$@" >"$OUT/$mode.txt" 2>"$WORK/$mode.err"; then
    printf '  %-8s %s lines\n' "$mode" "$(wc -l <"$OUT/$mode.txt" | tr -d ' ')"
  else
    printf '  %-8s FAILED (exit %s), see %s\n' "$mode" "$?" "$WORK/$mode.err" >&2
    cat "$WORK/$mode.err" >&2
    return 1
  fi
}

failed=0
capture bash    bash "$ROOT/scripts/snapshot-bash.sh"          -n "$NS" || failed=1
capture node    node "$ROOT/scripts/snapshot-node.js"          -n "$NS" || failed=1
capture workers node "$ROOT/scripts/snapshot-node-workers.js"  -n "$NS" || failed=1
capture procs   node "$ROOT/scripts/snapshot-node-procs.js"    -n "$NS" || failed=1
# cmd/k8s-export is its own module, so `go run` has to be pointed at it with -C
# rather than given a path from the repo root.
capture go      go -C "$ROOT/cmd/k8s-export" run .             -n "$NS" || failed=1

exit "$failed"
