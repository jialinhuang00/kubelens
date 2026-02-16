#!/usr/bin/env bash
# k8s-export.sh — Dump all k8s resources to k8s-snapshot/ for offline use
#
# Usage:
#   ./scripts/k8s-export.sh                          # all namespaces (default)
#   ./scripts/k8s-export.sh -n my-namespace           # single namespace
#   ./scripts/k8s-export.sh -n demo -n kube-system   # multiple namespaces
#   ./scripts/k8s-export.sh --cluster-scoped           # also export cluster-scoped resources

set -euo pipefail

# --- Config ---
NAMESPACES=()
ALL_NS=true
CLUSTER_SCOPED=false
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

# Clean previous snapshot
rm -rf "$BASE_DIR"

# --- Export namespaced resources ---
for ns in "${NAMESPACES[@]}"; do
  echo "=== Namespace: $ns ==="
  NS_DIR="${BASE_DIR}/${ns}"
  mkdir -p "$NS_DIR"

  for resource in "${NS_RESOURCES[@]}"; do
    count=$(kubectl get "$resource" -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      echo "  $resource ($count objects)"
      kubectl get "$resource" -n "$ns" -o yaml > "${NS_DIR}/${resource}.yaml"
    fi
  done

  # Export pod YAML + reference snapshots
  count=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" -gt 0 ]]; then
    echo "  pods ($count objects)"
    kubectl get pods -n "$ns" -o yaml > "${NS_DIR}/pods.yaml"
  fi
  kubectl get pods -n "$ns" -o wide > "${NS_DIR}/pods-snapshot.txt" 2>/dev/null || true
  kubectl get pods -n "$ns" -o custom-columns="POD:metadata.name,IMAGE:spec.containers[*].image" \
    > "${NS_DIR}/pods-images.txt" 2>/dev/null || true

  echo ""
done

# --- Export cluster-scoped resources ---
if [[ "$CLUSTER_SCOPED" == "true" ]]; then
  echo "=== Cluster-scoped resources ==="
  CLUSTER_DIR="${BASE_DIR}/_cluster"
  mkdir -p "$CLUSTER_DIR"

  for resource in "${CLUSTER_RESOURCES[@]}"; do
    count=$(kubectl get "$resource" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      echo "  $resource ($count objects)"
      kubectl get "$resource" -o yaml > "${CLUSTER_DIR}/${resource}.yaml"
    fi
  done
  echo ""
fi

# --- Summary ---
TOTAL_FILES=$(find "$BASE_DIR" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BASE_DIR" | cut -f1)
echo "Done! Exported $TOTAL_FILES files ($TOTAL_SIZE) to k8s-snapshot/"
echo ""
echo "Tip: to restore a resource later:"
echo "  kubectl apply -f k8s-snapshot/<namespace>/<resource>.yaml"
