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

# --- Config ---
NAMESPACES=()
ALL_NS=true
CLUSTER_SCOPED=false
RESUME=false
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/../k8s-snapshot"

# Namespaced resource types to export
NS_RESOURCES=(
  deployments
  services
  configmaps
  secrets
  ingresses
  statefulsets
  daemonsets
  cronjobs
  jobs
  persistentvolumeclaims
  serviceaccounts
  roles
  rolebindings
  networkpolicies
  horizontalpodautoscalers
  poddisruptionbudgets
  endpoints
  gateways.gateway.networking.k8s.io
  httproutes.gateway.networking.k8s.io
  tcproutes.gateway.networking.k8s.io
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

# --- Preflight ---
CONTEXT=$(kubectl config current-context)
echo "Cluster context: $CONTEXT"
echo "Export target:   $BASE_DIR"
echo "Namespaces:      ${NAMESPACES[*]}"
echo ""

# Clean previous snapshot (skip if resuming)
if [[ "$RESUME" == "true" ]]; then
  rm -f "${BASE_DIR}/.export-complete"
  # Filter out completed namespaces (those with .done marker)
  ALL_COUNT=${#NAMESPACES[@]}
  REMAINING=()
  for ns in "${NAMESPACES[@]}"; do
    if [[ -f "${BASE_DIR}/${ns}/.done" ]]; then
      echo "=== Namespace: $ns === (complete, skipping)"
    else
      REMAINING+=("$ns")
    fi
  done
  echo "Resuming: ${#REMAINING[@]} remaining out of $ALL_COUNT namespaces"
  echo ""
  NAMESPACES=("${REMAINING[@]}")
else
  rm -rf "$BASE_DIR"
fi

# --- Export namespaced resources ---
for ns in "${NAMESPACES[@]}"; do
  echo "=== Namespace: $ns ==="
  NS_DIR="${BASE_DIR}/${ns}"
  mkdir -p "$NS_DIR"

  for resource in "${NS_RESOURCES[@]}"; do
    OUT_FILE="${NS_DIR}/${resource}.yaml"
    if [[ "$RESUME" == "true" && -f "$OUT_FILE" ]]; then
      echo "  $resource (exists, skipped)"
      continue
    fi
    count=$(kubectl get "$resource" -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      echo "  $resource ($count objects)"
      kubectl get "$resource" -n "$ns" -o yaml > "${OUT_FILE}.tmp" && mv "${OUT_FILE}.tmp" "$OUT_FILE"
    fi
  done

  # Export pod YAML + reference snapshots
  if [[ "$RESUME" == "true" && -f "${NS_DIR}/pods.yaml" ]]; then
    echo "  pods (exists, skipped)"
  else
    count=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      echo "  pods ($count objects)"
      kubectl get pods -n "$ns" -o yaml > "${NS_DIR}/pods.yaml.tmp" && mv "${NS_DIR}/pods.yaml.tmp" "${NS_DIR}/pods.yaml"
    fi
  fi
  if [[ "$RESUME" != "true" || ! -f "${NS_DIR}/pods-snapshot.txt" ]]; then
    kubectl get pods -n "$ns" -o wide > "${NS_DIR}/pods-snapshot.txt.tmp" 2>/dev/null && mv "${NS_DIR}/pods-snapshot.txt.tmp" "${NS_DIR}/pods-snapshot.txt" || true
  fi
  if [[ "$RESUME" != "true" || ! -f "${NS_DIR}/pods-images.txt" ]]; then
    kubectl get pods -n "$ns" -o custom-columns="POD:metadata.name,IMAGE:spec.containers[*].image" \
      > "${NS_DIR}/pods-images.txt.tmp" 2>/dev/null && mv "${NS_DIR}/pods-images.txt.tmp" "${NS_DIR}/pods-images.txt" || true
  fi

  # Mark namespace as complete
  touch "${NS_DIR}/.done"
  echo ""
done

# --- Export cluster-scoped resources ---
if [[ "$CLUSTER_SCOPED" == "true" ]]; then
  echo "=== Cluster-scoped resources ==="
  CLUSTER_DIR="${BASE_DIR}/_cluster"
  mkdir -p "$CLUSTER_DIR"

  for resource in "${CLUSTER_RESOURCES[@]}"; do
    OUT_FILE="${CLUSTER_DIR}/${resource}.yaml"
    count=$(kubectl get "$resource" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      echo "  $resource ($count objects)"
      kubectl get "$resource" -o yaml > "${OUT_FILE}.tmp" && mv "${OUT_FILE}.tmp" "$OUT_FILE"
    fi
  done
  echo ""
fi

# --- Mark complete ---
touch "${BASE_DIR}/.export-complete"

# --- Summary ---
TOTAL_FILES=$(find "$BASE_DIR" -type f ! -name '.export-complete' ! -name '.done' ! -name '*.tmp' | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BASE_DIR" | cut -f1)
echo "Done! Exported $TOTAL_FILES files ($TOTAL_SIZE) to k8s-snapshot/"
echo ""
echo "Tip: to restore a resource later:"
echo "  kubectl apply -f k8s-snapshot/<namespace>/<resource>.yaml"
