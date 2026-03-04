#!/usr/bin/env bash
# k8s-export.sh — Dump all k8s resources to k8s-snapshot/ for offline use
#
# Usage:
#   ./scripts/k8s-export.sh                          # all namespaces (default)
#   ./scripts/k8s-export.sh -n my-namespace           # single namespace
#   ./scripts/k8s-export.sh -n demo -n kube-system   # multiple namespaces
#   ./scripts/k8s-export.sh --cluster-scoped           # also export cluster-scoped resources
#   ./scripts/k8s-export.sh --resume                    # skip already-exported files

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
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/../k8s-snapshot"

# Namespaced resource types to export — split into parallel batches
# Batch 1: Pods (usually the most objects, benefits from running alone)
# Batch 2: Core workloads
# Batch 3: Config, auth & storage
# Batch 4: Networking & scaling (typically few objects each)
NS_BATCHES=(
  "pods"
  "deployments,statefulsets,daemonsets,cronjobs,jobs"
  "configmaps,secrets,serviceaccounts,persistentvolumeclaims,roles,rolebindings,resourcequotas,limitranges"
  "services,ingresses,endpoints,networkpolicies,horizontalpodautoscalers,poddisruptionbudgets"
)

# CRD resource types — checked once at startup, skipped if CRDs not installed
CRD_RESOURCES=(
  gateways.gateway.networking.k8s.io
  httproutes.gateway.networking.k8s.io
  tcproutes.gateway.networking.k8s.io
  virtualservices.networking.istio.io
  destinationrules.networking.istio.io
  serviceentries.networking.istio.io
  applications.argoproj.io
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
    -h|--help)
      head -9 "$0" | tail -7; exit 0 ;;
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

# --- Check CRDs in background (runs while first namespace exports) ---
CRD_RESULT_FILE=$(mktemp)
(
  CRD_BATCH=""
  for crd in "${CRD_RESOURCES[@]}"; do
    if kubectl get "$crd" --all-namespaces --no-headers 2>/dev/null | head -1 | grep -q .; then
      if [[ -n "$CRD_BATCH" ]]; then CRD_BATCH+=","; fi
      CRD_BATCH+="$crd"
      echo -e "${GREEN}CRD available: $crd${RESET}"
    else
      echo -e "${GRAY}CRD not found: $crd (skipping)${RESET}"
    fi
  done
  echo "$CRD_BATCH" > "$CRD_RESULT_FILE"
) &
CRD_CHECK_PID=$!

# --- Preflight ---
CONTEXT=$(kubectl config current-context)
EXPORT_START=$(date +%s)
echo "Cluster context: $CONTEXT"
echo "Export target:   $BASE_DIR"
echo "Namespaces:      ${NAMESPACES[*]}"
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

# --- Export namespaced resources ---
CRD_MERGED=false
for ns in "${NAMESPACES[@]}"; do
  NS_START=$(date +%s)
  echo "=== Namespace: $ns ==="
  NS_DIR="${BASE_DIR}/${ns}"
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

  # Export pod reference snapshots (pod YAML is handled by the batch above)
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

  # After first namespace's core batches finish, merge CRD results and backfill
  if [[ "$CRD_MERGED" == "false" ]]; then
    wait "$CRD_CHECK_PID" 2>/dev/null || true
    CRD_BATCH=$(cat "$CRD_RESULT_FILE" 2>/dev/null)
    rm -f "$CRD_RESULT_FILE"
    if [[ -n "$CRD_BATCH" ]]; then
      NS_BATCHES+=("$CRD_BATCH")
      # Backfill: export CRDs for this first namespace
      (
        echo -e "  ${YELLOW}→ fetching ${CRD_BATCH}${RESET}"
        if kubectl get "$CRD_BATCH" -n "$ns" -o json 2>/dev/null \
          | node "${SCRIPT_DIR}/split-resources.js" "$NS_DIR" "$RESUME"; then
          echo -e "  ${GREEN}← ${CRD_BATCH} done${RESET}"
        else
          echo -e "  ${RED}← ${CRD_BATCH} failed${RESET}"
        fi
      )
    fi
    CRD_MERGED=true
  fi

  # Mark namespace as complete
  touch "${NS_DIR}/.done"

  NS_END=$(date +%s)
  NS_ELAPSED=$((NS_END - NS_START))
  echo -e "${GREEN}✓ Namespace $ns completed in ${NS_ELAPSED}s${RESET}"
  echo ""
done

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
