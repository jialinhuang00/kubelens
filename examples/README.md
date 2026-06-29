# Try kubelens locally (no cluster needed)

No cluster to point at? Spin up a throwaway one with [kind](https://kind.sigs.k8s.io/)
and a small demo app, then explore it in kubelens.

The demo app is a 3-service topology: a frontend-facing **gateway** (A) that calls
**orders** (B) and **inventory** (C), wired with a ConfigMap, a Secret, and
LoadBalancer/ClusterIP Services — enough for the graph to show real relationships.

## Steps

```bash
# 1. Create the cluster (maps host:8080 → the gateway NodePort)
kind create cluster --config examples/kind-config.yaml

# 2. Deploy the demo app
kubectl apply -f examples/demo-cluster.yaml
kubectl wait -n demo --for=condition=available deploy --all --timeout=90s

# 3. Run kubelens against it
pnpm install
pnpm run dev
```

Open `http://localhost:4200`, stay in **Realtime** mode, and pick the `demo`
namespace. The Universe graph shows gateway/orders/inventory and their edges to the
ConfigMap and Secret.

## See load balancing in the browser (optional)

The gateway is published at `http://localhost:8080` (via the port mapping in
`kind-config.yaml`). Open it and click **Hit B ×20** — each request hits a fresh
gateway pod and proxies to one of the two `orders` pods, so the tally shows traffic
spread across pod names. That's kube-proxy load-balancing, live.

## Tear down

```bash
kind delete cluster
```
