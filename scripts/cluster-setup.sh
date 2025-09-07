#!/bin/bash

# Kubernetes Test Environment Setup Script
# For kubecmds-viz project testing

set -e  # Exit on any error

echo "🚀 Setting up Kubernetes test environment..."

# Color definitions - improved visibility
RED='\033[1;31m'      # Bold red
GREEN='\033[1;32m'    # Bold green  
YELLOW='\033[1;33m'   # Bold yellow
BLUE='\033[1;36m'     # Bold cyan (more visible than blue)
NC='\033[0m'          # No Color

print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 1. Check required tools
print_step "Checking required tools..."

if ! command -v docker &> /dev/null; then
    print_error "Docker not installed. Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker not running. Please start Docker Desktop and retry"
    exit 1
fi

print_success "Docker ready"

if ! command -v kubectl &> /dev/null; then
    print_warning "kubectl not installed, installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install kubectl
    else
        print_error "Please install kubectl manually: https://kubernetes.io/docs/tasks/tools/"
        exit 1
    fi
fi

print_success "kubectl ready"

if ! command -v kind &> /dev/null; then
    print_warning "kind not installed, installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install kind
    else
        print_error "Please install kind manually: https://kind.sigs.k8s.io/docs/user/quick-start/"
        exit 1
    fi
fi

print_success "kind ready"

# 2. Check existing cluster
print_step "Checking existing cluster..."
if kind get clusters | grep -q "kubecmds-test"; then
    print_warning "Found existing kubecmds-test cluster"
    read -p "Delete and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_step "Deleting existing cluster..."
        kind delete cluster --name kubecmds-test
        print_success "Cluster deleted"
        # Create new cluster after deletion
        print_step "Creating new kind cluster..."
        kind create cluster --config=kind-config.yaml
        print_success "New cluster created"
    else
        print_warning "Using existing cluster"
        kubectl config use-context kind-kubecmds-test
    fi
else
    # 3. Create Kind Cluster
    print_step "Creating kind cluster..."
    kind create cluster --config=kind-config.yaml
    print_success "Cluster created"
fi

# 4. Wait for nodes to be ready
print_step "Waiting for nodes to be ready..."
sleep 10
kubectl wait --for=condition=Ready nodes --all --timeout=300s
print_success "All nodes ready"

# 5. Create Namespaces
print_step "Creating namespaces..."
kubectl create namespace noah --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace staging --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace production --dry-run=client -o yaml | kubectl apply -f -
print_success "Namespaces created"

# 6. Deploy services
print_step "Deploying services to cluster..."

if [ -d "k8s-manifests" ]; then
    for manifest in k8s-manifests/*.yaml; do
        if [ -f "$manifest" ]; then
            print_step "Deploying $manifest..."
            kubectl apply -f "$manifest"
            print_success "Deployed $(basename $manifest)"
        fi
    done
else
    print_warning "k8s-manifests directory not found, skipping deployment"
fi

# 7. Wait for deployment completion
print_step "Waiting for all pods to be ready..."
sleep 5
kubectl wait --for=condition=Ready pods --all -n noah --timeout=300s 2>/dev/null || true
kubectl wait --for=condition=Ready pods --all -n staging --timeout=300s 2>/dev/null || true
kubectl wait --for=condition=Ready pods --all -n production --timeout=300s 2>/dev/null || true

# 8. Display environment status
echo
echo "🎉 Kubernetes test environment setup complete!"
echo
print_step "Environment status:"
echo "Cluster: $(kubectl config current-context)"
echo "Nodes:"
kubectl get nodes --no-headers | while read node status role age version; do
    echo "  • $node ($status)"
done

echo
echo "Namespaces:"
kubectl get namespaces noah staging production --no-headers | while read name status age; do
    echo "  • $name ($status)"
done

echo
echo "Deployed services:"
for ns in noah staging production; do
    if kubectl get pods -n "$ns" --no-headers 2>/dev/null | head -1 > /dev/null; then
        echo "📦 Namespace: $ns"
        kubectl get pods -n "$ns" --no-headers 2>/dev/null | while read pod ready status restarts age; do
            echo "  • $pod ($status)"
        done
    fi
done

echo
print_step "Sample test commands:"
echo "kubectl get pods -n noah"
echo "kubectl get deployments -n noah"
echo "kubectl get pods -n noah -o wide"
echo "kubectl rollout status deployment/joke-service -n noah"
echo
print_success "Ready to test kubecmds-viz!"
print_step "Frontend: http://localhost:4200"
print_step "Backend: http://localhost:3000"