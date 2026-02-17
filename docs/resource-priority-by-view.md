# Resource Priority by View & Role

Different views serve different users and workflows. This doc defines which K8s resource types matter most in each context.

## Roles

- **SWE** (Software Engineer) — deploys app code, debugs runtime issues, checks logs
- **DevOps** — manages infrastructure, RBAC, scaling, networking, storage

## Terminal View — Operational / Debugging

Execute commands, inspect individual resources, manage rollouts.

| Priority | Resources | Primary User | Use Case |
|----------|-----------|-------------|----------|
| High | `pods` | SWE + DevOps | Logs, exec, restart, debug |
| High | `deployments` | SWE + DevOps | Rollout status, scale, image updates |
| High | `services` | SWE + DevOps | Connectivity, port mapping |
| High | `configmaps`, `secrets` | SWE + DevOps | App configuration, env vars |
| Medium | `cronjobs`, `jobs` | SWE | Scheduled task failures |
| Medium | `ingresses`, `gateways` | DevOps | Routing issues |
| Medium | `statefulsets` | DevOps | Stateful workloads (DB, MQ) |
| Medium | `daemonsets` | DevOps | Node-level agents (monitoring, logging) |
| Low | `hpa`, `pdb` | DevOps | Scaling / disruption rules (set-and-forget) |
| Low | `networkpolicies` | DevOps | Network segmentation |
| Low | `roles`, `rolebindings` | DevOps | RBAC setup |
| Low | `resourcequotas`, `limitranges` | DevOps | Namespace resource limits |
| Skip | `endpoints` | — | Auto-generated, rarely inspected directly |

## Universe View — Topology / Relationships

GPU-accelerated resource graph. Focus on how resources connect, not individual state.

| Priority | Resources | Reason |
|----------|-----------|--------|
| High | `deployments`, `statefulsets`, `daemonsets` | Core nodes — connect to configmap, secret, service, PVC |
| High | `services` | Network topology hub — links workloads to ingress |
| High | `ingresses`, `gateways`, `httproutes` | External entry points, route chain visualization |
| High | `configmaps`, `secrets` | Shared by multiple workloads — fan-out relationships |
| Medium | `serviceaccounts` → `roles` → `rolebindings` | RBAC permission chain |
| Medium | `persistentvolumeclaims` | Storage attachment relationships |
| Medium | `hpa` | Points to deployment/statefulset (scaling edge) |
| Low | `pods` | Too many, too granular — clutters the graph |
| Low | `cronjobs`, `jobs` | Short-lived, simple relationships |
| Skip | `endpoints` | Auto-generated, no meaningful topology |
| Skip | `resourcequotas`, `limitranges` | Namespace-level config, no resource edges |
| Skip | `pdb`, `networkpolicies` | Policy objects, no visual topology value |

## Key Differences

| Aspect | Terminal | Universe |
|--------|----------|---------|
| **Pods** | Most important (debug target) | Hide or collapse (too much noise) |
| **Endpoints** | Occasionally useful | Never needed |
| **Ingress/Gateway** | Medium (check routing) | High (entry point visualization) |
| **RBAC** | Low (occasional lookup) | Medium (permission chain edges) |
| **ConfigMap/Secret** | High (read values) | High (shared-by relationships) |

## Implications

- `resource-counts` API could return a weighted/filtered subset per view
- Universe graph should deprioritize or group pods (e.g. show "12 pods" as one node)
- Terminal sidebar could order resource categories by the priority above
- CRD resources (gateways, httproutes, tcproutes) only relevant if Gateway API is installed
