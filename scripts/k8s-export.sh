#!/usr/bin/env bash
# k8s-export.sh — Dump all k8s resources to k8s-snapshot/ for offline use
#
# Usage:
#   ./scripts/k8s-export.sh                          # all namespaces (default)
#   ./scripts/k8s-export.sh -n my-namespace           # single namespace
#   ./scripts/k8s-export.sh -n demo -n kube-system   # multiple namespaces
#   ./scripts/k8s-export.sh --cluster-scoped           # also export cluster-scoped resources
#   ./scripts/k8s-export.sh --resume                    # skip already-exported files
#   ./scripts/k8s-export.sh --jobs 3                    # parallel namespaces (default: 3)

set -euo pipefail

# --- Colors ---
YELLOW='\033[33m'
GREEN='\033[32m'
RED='\033[31m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Config ---
NAMESPACES=()
ALL_NS=true
CLUSTER_SCOPED=false
RESUME=false
PARALLEL_NS=3
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/../k8s-snapshot"

# Namespaced resource types to export — split into parallel batches
# Pods are handled separately (usually the most objects)
# Finer-grained batches prevent slow resources (e.g. many secrets) from blocking others
# CRDs are included as fixed batches — if they don't exist, kubectl will return empty (no overhead)
NS_BATCHES=(
  "deployments,statefulsets,daemonsets,cronjobs,jobs"                                           # Batch 1: Workloads (5 types)
  "services,ingresses,endpoints"                                                                # Batch 2: Networking core (3 types)
  "configmaps,secrets,serviceaccounts"                                                          # Batch 3: Config & auth (3 types)
  "persistentvolumeclaims,roles,rolebindings"                                                   # Batch 4: Storage & RBAC (3 types)
  "networkpolicies,horizontalpodautoscalers,poddisruptionbudgets"                              # Batch 5: Policies (3 types)
  "gateways.gateway.networking.k8s.io,httproutes.gateway.networking.k8s.io,tcproutes.gateway.networking.k8s.io,applications.argoproj.io"  # Batch 6: CRDs (Gateway API + ArgoCD)
)

# Cluster-scoped resource types
CLUSTER_RESOURCES=(
  namespaces
  clusterroles
  clusterrolebindings
  storageclasses
  persistentvolumes
  customresourcedefinitions
  ingressclasses
)

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace)
      NAMESPACES+=("$2"); ALL_NS=false; shift 2 ;;
    --cluster-scoped)
      CLUSTER_SCOPED=true; shift ;;
    --resume)
      RESUME=true; shift ;;
    --jobs)
      PARALLEL_NS="$2"; shift 2 ;;
    -h|--help)
      head -10 "$0" | tail -8; exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# If --all-namespaces (default), discover them
if [[ "$ALL_NS" == "true" ]]; then
  echo "Checking cluster connection..."
  if ! kubectl cluster-info &>/dev/null; then
    echo "ERROR: Cannot connect to cluster. Run 'aws sso login' and update kubeconfig first."
    exit 1
  fi
  while IFS= read -r ns; do NAMESPACES+=("$ns"); done < <(kubectl get namespaces -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n')
  echo "Discovered ${#NAMESPACES[@]} namespaces"
elif [[ ${#NAMESPACES[@]} -eq 0 ]]; then
  echo "No namespaces specified. Use -n <namespace> or run without args for all."
  exit 1
fi

# No CRD checking needed — CRDs are included as fixed batches
# If a CRD doesn't exist, kubectl get will return empty without error

# --- Preflight ---
CONTEXT=$(kubectl config current-context)
EXPORT_START=$(date +%s)
echo "Cluster context: $CONTEXT"
echo "Export target:   $BASE_DIR"
echo "Namespaces:      ${NAMESPACES[*]}"
echo "Parallel jobs:   $PARALLEL_NS"
echo ""

# Clean previous snapshot (skip if resuming)
if [[ "$RESUME" == "true" ]]; then
  rm -f "${BASE_DIR}/.export-complete"
  find "$BASE_DIR" -name '*.tmp' -delete 2>/dev/null || true
  # Filter out completed namespaces (those with .done marker)
  ALL_COUNT=${#NAMESPACES[@]}
  REMAINING=()
  for ns in "${NAMESPACES[@]}"; do
    if [[ -f "${BASE_DIR}/${ns}/.done" ]]; then
      echo -e "${GRAY}=== Namespace: $ns === (complete, skipping)${RESET}"
    else
      REMAINING+=("$ns")
    fi
  done
  echo "Resuming: ${#REMAINING[@]} remaining out of $ALL_COUNT namespaces"
  echo ""
  if [[ ${#REMAINING[@]} -eq 0 ]]; then
    NAMESPACES=()
  else
    NAMESPACES=("${REMAINING[@]}")
  fi
else
  rm -rf "$BASE_DIR"
fi

# --- Namespace export function ---
export_one_namespace() {
  local ns="$1"
  local NS_START NS_END NS_ELAPSED
  NS_START=$(date +%s)
  echo "=== Namespace: $ns ==="
  local NS_DIR="${BASE_DIR}/${ns}"
  mkdir -p "$NS_DIR"

  # Run all batches in parallel — each batch is one kubectl call
  for batch in "${NS_BATCHES[@]}"; do
    (
      echo -e "  ${YELLOW}→ fetching ${batch}${RESET}"
      if kubectl get "$batch" -n "$ns" -o json 2>/dev/null \
        | node "${SCRIPT_DIR}/split-resources.js" "$NS_DIR" "$RESUME"; then
        echo -e "  ${GREEN}← ${batch} done${RESET}"
      else
        echo -e "  ${RED}← ${batch} failed${RESET}"
      fi
    ) &
  done

  # Export pods separately (usually many objects, deserves its own parallel task)
  (
    echo -e "  ${YELLOW}→ fetching pods${RESET}"
    if kubectl get pods -n "$ns" -o json 2>/dev/null \
      | node "${SCRIPT_DIR}/split-resources.js" "$NS_DIR" "$RESUME"; then
      echo -e "  ${GREEN}← pods done${RESET}"
    else
      echo -e "  ${RED}← pods failed${RESET}"
    fi
  ) &

  # Export pod reference snapshots
  if [[ "$RESUME" != "true" || ! -f "${NS_DIR}/pods-snapshot.txt" ]]; then
    (
      echo -e "  ${YELLOW}→ fetching pods-snapshot${RESET}"
      if kubectl get pods -n "$ns" -o wide > "${NS_DIR}/pods-snapshot.txt.tmp" 2>/dev/null \
        && mv "${NS_DIR}/pods-snapshot.txt.tmp" "${NS_DIR}/pods-snapshot.txt"; then
        echo -e "  ${GREEN}← pods-snapshot done${RESET}"
      else
        echo -e "  ${RED}← pods-snapshot failed${RESET}"
      fi
    ) &
  fi
  if [[ "$RESUME" != "true" || ! -f "${NS_DIR}/pods-images.txt" ]]; then
    (
      echo -e "  ${YELLOW}→ fetching pods-images${RESET}"
      if kubectl get pods -n "$ns" -o custom-columns="POD:metadata.name,IMAGE:spec.containers[*].image" \
        > "${NS_DIR}/pods-images.txt.tmp" 2>/dev/null \
        && mv "${NS_DIR}/pods-images.txt.tmp" "${NS_DIR}/pods-images.txt"; then
        echo -e "  ${GREEN}← pods-images done${RESET}"
      else
        echo -e "  ${RED}← pods-images failed${RESET}"
      fi
    ) &
  fi
  wait

  # Mark namespace as complete
  touch "${NS_DIR}/.done"

  NS_END=$(date +%s)
  NS_ELAPSED=$((NS_END - NS_START))
  echo -e "${GREEN}✓ Namespace $ns completed in ${NS_ELAPSED}s${RESET}"
  echo ""
}

# --- Export namespaced resources (parallel batches) ---
if [[ ${#NAMESPACES[@]} -gt 0 ]]; then
  _batch_count=0
  _batch_pids=()

  for ns in "${NAMESPACES[@]}"; do
    export_one_namespace "$ns" &
    _batch_pids+=($!)
    _batch_count=$((_batch_count + 1))

    if [[ $_batch_count -ge $PARALLEL_NS ]]; then
      # Wait for this batch before starting the next
      for _pid in "${_batch_pids[@]}"; do wait "$_pid" 2>/dev/null || true; done
      _batch_pids=()
      _batch_count=0
    fi
  done

  # Wait for any remaining namespaces
  if [[ ${#_batch_pids[@]} -gt 0 ]]; then
    for _pid in "${_batch_pids[@]}"; do wait "$_pid" 2>/dev/null || true; done
  fi
fi

# --- Export cluster-scoped resources ---
if [[ "$CLUSTER_SCOPED" == "true" ]]; then
  echo "=== Cluster-scoped resources ==="
  CLUSTER_DIR="${BASE_DIR}/_cluster"
  mkdir -p "$CLUSTER_DIR"

  for resource in "${CLUSTER_RESOURCES[@]}"; do
    OUT_FILE="${CLUSTER_DIR}/${resource}.yaml"
    echo -e "  ${YELLOW}→ fetching ${resource}${RESET}"
    count=$(kubectl get "$resource" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      if kubectl get "$resource" -o yaml > "${OUT_FILE}.tmp" && mv "${OUT_FILE}.tmp" "$OUT_FILE"; then
        echo -e "  ${GREEN}← ${resource} done ($count objects)${RESET}"
      else
        echo -e "  ${RED}← ${resource} failed${RESET}"
      fi
    else
      echo -e "  ${GREEN}← ${resource} done (empty)${RESET}"
    fi
  done
  echo ""
fi

# --- Mark complete ---
touch "${BASE_DIR}/.export-complete"

# --- Summary ---
EXPORT_END=$(date +%s)
TOTAL_ELAPSED=$((EXPORT_END - EXPORT_START))
TOTAL_FILES=$(find "$BASE_DIR" -type f ! -name '.export-complete' ! -name '.done' ! -name '*.tmp' | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BASE_DIR" | cut -f1)

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}║  Export Complete                                         ║${RESET}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${RESET}"
echo -e "${GREEN}║  Files:        ${TOTAL_FILES} files${RESET}"
echo -e "${GREEN}║  Size:         ${TOTAL_SIZE}${RESET}"
echo -e "${GREEN}║  Time:         ${TOTAL_ELAPSED}s${RESET}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "Tip: to restore a resource later:"
echo "  kubectl apply -f k8s-snapshot/<namespace>/<resource>.yaml"
