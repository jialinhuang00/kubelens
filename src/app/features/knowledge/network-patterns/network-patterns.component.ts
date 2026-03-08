import { Component, input, computed } from '@angular/core';
import { NgClass } from '@angular/common';

export type NetworkType =
  'ClusterIP' | 'NodePort' | 'LoadBalancer'
  | 'NodeNamespace' | 'Ingress' | 'Gateway' | 'ProxyMode'
  | 'MasterWorker' | 'ScenarioDeploy' | 'ScenarioCrash' | 'ScenarioTraffic'
  | 'Interfaces' | 'WorkloadTypes' | 'PodLifecycle';

export interface NetBlock {
  label: string;
  sub?: string;
  x: number; y: number; w: number; h: number;
  kind: 'external' | 'node' | 'service' | 'pod';
}

export interface NetEdge {
  x1: number; y1: number;
  x2: number; y2: number;
  bend?: boolean;
  label?: string;
}

export interface NetBound {
  label: string;
  x: number; y: number; w: number; h: number;
  style?: 'node' | 'ns-game' | 'ns-shop' | 'ns-db';
  labelPos?: 'top' | 'bottom';
}

export interface NetDiagram {
  svgW: number;
  svgH: number;
  steps: string[];
  ip: string;
  yaml: string;
  bounds: NetBound[];
  blocks: NetBlock[];
  edges: NetEdge[];
  table?: { cols: string[]; rows: string[][] };
  svgHide?: boolean;
}

// ── Diagram definitions ────────────────────────────────────────────────────

const CLUSTERIP: NetDiagram = {
  svgW: 360, svgH: 310,
  steps: [
    'Who accesses: Pods or Services inside the cluster (unreachable from outside)',
    'Pod sends a request using the Service name (e.g. my-service:80)',
    'CoreDNS resolves the name to a ClusterIP (10.96.x.x)',
    'kube-proxy on each Node intercepts the packet via iptables/ipvs rules',
    'DNAT: 10.96.x.x:80 → randomly selected ready Pod (10.244.x.x:3000)',
  ],
  ip: '10.96.x.x  (virtual IP, cluster-internal)',
  yaml: `spec:
  type: ClusterIP
  clusterIP: 10.96.x.x
  ports:
    - port: 80
      targetPort: 3000`,
  bounds: [
    { label: 'Kubernetes cluster', x: 20, y: 60, w: 320, h: 240 },
  ],
  blocks: [
    { label: 'Traffic',  sub: 'from other Pod / Service',  x: 100, y: 10,  w: 160, h: 38, kind: 'external' },
    { label: 'Service',  sub: '10.96.x.x : port 80',       x:  90, y: 108, w: 180, h: 46, kind: 'service'  },
    { label: 'Pod',      sub: '10.244.x.x : 3000', x:  20, y: 222, w: 90, h: 46, kind: 'pod' },
    { label: 'Pod',      sub: '10.244.x.x : 3000', x: 135, y: 222, w: 90, h: 46, kind: 'pod' },
    { label: 'Pod',      sub: '10.244.x.x : 3000', x: 250, y: 222, w: 90, h: 46, kind: 'pod' },
  ],
  edges: [
    { x1: 180, y1: 48,  x2: 180, y2: 108 },
    { x1: 140, y1: 154, x2:  65, y2: 222 },
    { x1: 180, y1: 154, x2: 180, y2: 222 },
    { x1: 220, y1: 154, x2: 295, y2: 222 },
  ],
};

const NODEPORT: NetDiagram = {
  svgW: 440, svgH: 410,
  steps: [
    'Who accesses: external users (knowing any Node VM IP)',
    'Node = physical machine (VM), kube-proxy opens port 32080 on every Node',
    'Traffic can hit any Node; the Pod may be on a different machine',
    'iptables DNAT → Service ClusterIP (10.96.x.x:80)',
    'Second DNAT → a Pod (10.244.x.x:3000), CNI overlay routes cross-Node',
  ],
  ip: '<node-ip>:32080  ·  10.96.x.x (ClusterIP, cluster-internal)',
  yaml: `spec:
  type: NodePort
  clusterIP: 10.96.x.x
  ports:
    - port: 80
      targetPort: 3000
      nodePort: 32080`,
  bounds: [
    { label: 'Kubernetes cluster', x: 20, y: 100, w: 400, h: 295 },
  ],
  blocks: [
    { label: 'Traffic', sub: 'from external',              x: 170, y:  10, w: 100, h: 36, kind: 'external' },
    { label: 'Node',    sub: 'VM  :32080',                 x:  30, y: 110, w: 110, h: 46, kind: 'node'     },
    { label: 'Node',    sub: 'VM  :32080',                 x: 165, y: 110, w: 110, h: 46, kind: 'node'     },
    { label: 'Node',    sub: 'VM  :32080',                 x: 300, y: 110, w: 110, h: 46, kind: 'node'     },
    { label: 'Service', sub: '10.96.x.x : port 80',       x: 140, y: 228, w: 160, h: 46, kind: 'service'  },
    { label: 'Pod',     sub: '10.244.x.x : 3000', x:  80, y: 318, w: 100, h: 46, kind: 'pod' },
    { label: 'Pod',     sub: '10.244.x.x : 3000', x: 260, y: 318, w: 100, h: 46, kind: 'pod' },
  ],
  edges: [
    { x1: 195, y1: 46, x2:  85, y2: 110 },
    { x1: 220, y1: 46, x2: 220, y2: 110 },
    { x1: 245, y1: 46, x2: 355, y2: 110 },
    { x1:  85, y1: 156, x2: 185, y2: 228, bend: true },
    { x1: 220, y1: 156, x2: 220, y2: 228 },
    { x1: 355, y1: 156, x2: 255, y2: 228, bend: true },
    { x1: 185, y1: 274, x2: 130, y2: 318 },
    { x1: 255, y1: 274, x2: 310, y2: 318 },
  ],
};

const LOADBALANCER: NetDiagram = {
  svgW: 360, svgH: 458,
  steps: [
    'Who accesses: external users (no need to know Node IPs)',
    'Connect to cloud LB external IP (203.0.x.x:80) — provisioned by AWS ELB / GCP / Azure',
    'LB picks a Node (VM) and forwards to NodePort (<node-ip>:32080)',
    'Forwarded to Service ClusterIP (10.96.x.x:80)',
    'Then forwarded to one of the Pods (10.244.x.x:3000)',
    'NodePort and ClusterIP access also remain available',
  ],
  ip: '203.0.x.x (external LB)  ·  <node-ip>:32080 (NodePort)  ·  10.96.x.x (ClusterIP)',
  yaml: `spec:
  type: LoadBalancer
  loadBalancerIP: 203.0.x.x
  clusterIP: 10.96.x.x
  ports:
    - port: 80
      targetPort: 3000
      nodePort: 32080`,
  bounds: [
    { label: 'Kubernetes cluster', x: 20, y: 132, w: 320, h: 306 },
  ],
  blocks: [
    { label: 'Traffic',       sub: 'from external',          x:  80, y:  10, w: 200, h: 38, kind: 'external' },
    { label: 'Load Balancer', sub: 'External IP: 203.0.x.x', x:  80, y:  66, w: 200, h: 48, kind: 'external' },
    { label: 'Node',          sub: 'VM  :32080',              x:  90, y: 152, w: 180, h: 46, kind: 'node'     },
    { label: 'Service',       sub: '10.96.x.x : port 80',    x:  90, y: 254, w: 180, h: 46, kind: 'service'  },
    { label: 'Pod',           sub: '10.244.x.x : 3000',      x:  40, y: 358, w: 100, h: 46, kind: 'pod' },
    { label: 'Pod',           sub: '10.244.x.x : 3000',      x: 220, y: 358, w: 100, h: 46, kind: 'pod' },
  ],
  edges: [
    { x1: 180, y1: 48,  x2: 180, y2:  66 },
    { x1: 180, y1: 114, x2: 180, y2: 152 },
    { x1: 180, y1: 198, x2: 180, y2: 254 },
    { x1: 145, y1: 300, x2:  90, y2: 358 },
    { x1: 215, y1: 300, x2: 270, y2: 358 },
  ],
};

// ── Node vs Namespace ───────────────────────────────────────────────────────
// game-api deployed with 2 replicas, Scheduler places them on different Nodes
// ns:maplestory spans two Nodes — Namespace is a logical group, not a physical boundary

const NODENAMESPACE: NetDiagram = {
  svgW: 500, svgH: 400,
  steps: [
    'Node = physical boundary (a VM or bare-metal), each Node has its own kubelet / kube-proxy',
    'Namespace = logical group (RBAC / quota / network policy), does not affect which Node a Pod lands on',
    'ns:maplestory spans Nodes Bera and Scania — Scheduler decides placement',
    'ns:henesys-shop only on Bera; ns:ellinia-db only on Scania',
    'To pin a Pod to a Node, use nodeSelector / nodeAffinity, not Namespace',
  ],
  ip: 'Node = VM boundary  ·  Namespace = logical group',
  yaml: `# Namespace cannot pin a Pod to a specific Node
# Use nodeSelector instead:
spec:
  nodeSelector:
    kubernetes.io/hostname: bera`,
  bounds: [
    { label: 'Node: Bera (VM)',   x:  15, y: 30, w: 215, h: 320, style: 'node',    labelPos: 'bottom' },
    { label: 'Node: Scania (VM)', x: 270, y: 30, w: 215, h: 320, style: 'node',    labelPos: 'bottom' },
    { label: 'ns: maplestory',    x:   5, y: 55, w: 490, h: 140, style: 'ns-game', labelPos: 'top'    },
    { label: 'ns: henesys-shop',  x:  25, y: 218, w: 195, h: 110, style: 'ns-shop', labelPos: 'bottom' },
    { label: 'ns: ellinia-db',    x: 280, y: 218, w: 195, h: 110, style: 'ns-db',   labelPos: 'bottom' },
  ],
  blocks: [
    { label: 'game-api', sub: '10.244.1.2 : 3000', x:  50, y:  80, w: 140, h: 46, kind: 'pod' },
    { label: 'game-api', sub: '10.244.2.2 : 3000', x: 310, y:  80, w: 140, h: 46, kind: 'pod' },
    { label: 'shop-api', sub: '10.244.1.3 : 3000', x:  50, y: 232, w: 140, h: 46, kind: 'pod' },
    { label: 'postgres', sub: '10.244.2.3 : 5432', x: 310, y: 232, w: 140, h: 46, kind: 'pod' },
  ],
  edges: [],
};

// ── Ingress ─────────────────────────────────────────────────────────────────
// Players connect to maple.game.com → Ingress routes by path

const INGRESS: NetDiagram = {
  svgW: 480, svgH: 440,
  steps: [
    'Who accesses: external users opening maple.game.com',
    'DNS resolves to the Ingress Controller external IP',
    'Ingress Controller (nginx / traefik) routes by host + path',
    '/api/* → game-api Service → Pod',
    '/shop/* → shop Service → Pod',
    '/auth/* → auth Service → Pod',
  ],
  ip: 'maple.game.com → Ingress Controller IP → path-based routing',
  yaml: `spec:
  rules:
    - host: maple.game.com
      http:
        paths:
          - path: /api/*
            backend:
              service: { name: game-api, port: 80 }
          - path: /shop/*
            backend:
              service: { name: shop, port: 80 }`,
  bounds: [
    { label: 'Kubernetes cluster', x: 20, y: 58, w: 440, h: 362 },
  ],
  blocks: [
    { label: 'maple.game.com', sub: 'Player traffic',       x: 140, y:  10, w: 200, h: 38, kind: 'external' },
    { label: 'Ingress',        sub: 'nginx / traefik',      x: 120, y:  78, w: 240, h: 46, kind: 'service'  },
    { label: 'game-api',       sub: 'Service :80',          x:  30, y: 210, w: 120, h: 40, kind: 'service'  },
    { label: 'shop',           sub: 'Service :80',          x: 180, y: 210, w: 120, h: 40, kind: 'service'  },
    { label: 'auth',           sub: 'Service :80',          x: 330, y: 210, w: 120, h: 40, kind: 'service'  },
    { label: 'game-api',       sub: '10.244.x.x : 3000',   x:  30, y: 350, w: 120, h: 40, kind: 'pod'      },
    { label: 'shop',           sub: '10.244.x.x : 3000',   x: 180, y: 350, w: 120, h: 40, kind: 'pod'      },
    { label: 'auth',           sub: '10.244.x.x : 3000',   x: 330, y: 350, w: 120, h: 40, kind: 'pod'      },
  ],
  edges: [
    { x1: 240, y1: 48,  x2: 240, y2: 78 },
    { x1: 200, y1: 124, x2:  90, y2: 210, bend: true, label: '/api/*'  },
    { x1: 240, y1: 124, x2: 240, y2: 210,              label: '/shop/*' },
    { x1: 280, y1: 124, x2: 390, y2: 210, bend: true, label: '/auth/*' },
    { x1:  90, y1: 250, x2:  90, y2: 350 },
    { x1: 240, y1: 250, x2: 240, y2: 350 },
    { x1: 390, y1: 250, x2: 390, y2: 350 },
  ],
};

// ── Gateway API ──────────────────────────────────────────────────────────────
// Key advantage: one Gateway handles multiple route types (HTTP / gRPC / TCP)
// Ingress only handles HTTP/HTTPS; Gateway API is protocol-agnostic

const GATEWAY: NetDiagram = {
  svgW: 540, svgH: 430,
  steps: [
    'Ingress only supports HTTP/HTTPS; Gateway API is protocol-agnostic',
    'Gateway declares multiple listeners (port 80 HTTP / port 9000 gRPC / port 5432 TCP)',
    'HTTPRoute, GRPCRoute, TCPRoute each attach to their matching listener',
    'Each Route is owned by its app team independently',
    'Infra team only manages the Gateway; no need to know app routing details',
  ],
  ip: 'Gateway API — one entry point, multiple protocols',
  yaml: `kind: Gateway
spec:
  gatewayClassName: nginx
  listeners:
    - name: http,  port: 80,   protocol: HTTP
    - name: grpc,  port: 9000, protocol: HTTP   # gRPC over HTTP/2
    - name: db,    port: 5432, protocol: TCP
---
kind: HTTPRoute
spec:
  parentRefs: [{ name: maple-gw, sectionName: http }]
  rules: [{ matches: [{ path: /api }], backendRefs: [game-api] }]
---
kind: GRPCRoute
spec:
  parentRefs: [{ name: maple-gw, sectionName: grpc }]
  rules: [{ backendRefs: [rpc-service] }]`,
  bounds: [
    { label: 'Kubernetes cluster',  x:  10, y:   0, w: 520, h: 428 },
    { label: 'Infra Team',          x:  20, y:  10, w: 500, h:  96, style: 'node',    labelPos: 'bottom' },
    { label: 'App Teams (independent)', x:  20, y: 158, w: 500, h:  96, style: 'ns-game', labelPos: 'bottom' },
  ],
  blocks: [
    { label: 'Gateway',    sub: 'maple-gw  port 80/9000/5432', x: 160, y:  18, w: 200, h: 56, kind: 'node'     },
    { label: 'HTTPRoute',  sub: 'port 80  /api/*',             x:  20, y: 166, w: 140, h: 44, kind: 'external' },
    { label: 'GRPCRoute',  sub: 'port 9000',                   x: 190, y: 166, w: 140, h: 44, kind: 'external' },
    { label: 'TCPRoute',   sub: 'port 5432',                   x: 360, y: 166, w: 140, h: 44, kind: 'external' },
    { label: 'game-api',   sub: 'Service :80',                 x:  20, y: 284, w: 140, h: 44, kind: 'service'  },
    { label: 'rpc-service',sub: 'Service :9000',               x: 190, y: 284, w: 140, h: 44, kind: 'service'  },
    { label: 'postgres',   sub: 'Service :5432',               x: 360, y: 284, w: 140, h: 44, kind: 'service'  },
    { label: 'game-api',   sub: '10.244.x.x : 3000',          x:  20, y: 368, w: 140, h: 44, kind: 'pod'      },
    { label: 'rpc-service',sub: '10.244.x.x : 9000',          x: 190, y: 368, w: 140, h: 44, kind: 'pod'      },
    { label: 'postgres',   sub: '10.244.x.x : 5432',          x: 360, y: 368, w: 140, h: 44, kind: 'pod'      },
  ],
  edges: [
    { x1: 260, y1: 74,  x2:  90, y2: 166, bend: true, label: 'HTTP'  },
    { x1: 260, y1: 74,  x2: 260, y2: 166,              label: 'gRPC'  },
    { x1: 260, y1: 74,  x2: 430, y2: 166, bend: true, label: 'TCP'   },
    { x1:  90, y1: 210, x2:  90, y2: 284 },
    { x1: 260, y1: 210, x2: 260, y2: 284 },
    { x1: 430, y1: 210, x2: 430, y2: 284 },
    { x1:  90, y1: 328, x2:  90, y2: 368 },
    { x1: 260, y1: 328, x2: 260, y2: 368 },
    { x1: 430, y1: 328, x2: 430, y2: 368 },
  ],
};

// ── iptables vs ipvs ─────────────────────────────────────────────────────────

const PROXYMODE: NetDiagram = {
  svgW: 0, svgH: 0,
  svgHide: true,
  steps: [
    'kube-proxy runs on every Node, maintaining Service → Pod forwarding rules',
    'iptables mode: each Service maps to a chain of DNAT rules, scanned sequentially',
    'ipvs mode: kernel hash table, O(1) lookup, supports multiple load-balancing algorithms',
    'Large clusters (Service > 1000) should use ipvs; iptables rule count explodes',
  ],
  ip: 'kube-proxy --proxy-mode=iptables (default) | ipvs',
  yaml: `# Switch to ipvs mode
kind: KubeProxyConfiguration
mode: ipvs
ipvs:
  scheduler: rr   # rr=round-robin, lc=least-conn, sh=source-hash`,
  bounds: [], blocks: [], edges: [],
  table: {
    cols: ['', 'iptables', 'ipvs'],
    rows: [
      ['Implementation',  'netfilter DNAT rule chain',       'kernel LVS hash table'  ],
      ['Lookup',          'O(n) sequential scan',            'O(1)'                   ],
      ['1000+ Services',  'rule explosion, latency spikes',  'stable performance'     ],
      ['Load balancing',  'random (probabilistic)',           'rr / lc / sh / sed ...' ],
      ['Session Affinity','ClientIP (recent module)',         'ClientIP'               ],
      ['Kernel modules',  'none',                            'ip_vs + ip_vs_*'        ],
      ['Default',         'yes',                             'no, must configure'     ],
    ],
  },
};

// ── Master Node vs Worker Nodes ─────────────────────────────────────────────

const MASTERWORKER: NetDiagram = {
  svgW: 560, svgH: 350,
  steps: [
    'Control Plane = decides what should happen, writes rules only',
    'Data Plane = does the actual work: runs containers, routes packets',
    'API Server is the communication hub — all state changes go through it',
    'etcd is the single source of truth for the entire cluster state',
    'How components run — kubelet: systemd binary (OS layer, always)',
    'How components run — kube-proxy: DaemonSet Pod (one per Node)',
    'How components run — apiserver / etcd / scheduler / controller-manager: Static Pod (kubeadm) or systemd (bare-metal)',
    'Static Pod = kubelet reads /etc/kubernetes/manifests/ and starts it directly, bypasses API Server, auto-restarts on crash',
    'EKS / GKE: Control Plane is cloud-managed, you never see these Pods',
  ],
  ip: 'API Server = hub  ·  etcd = source of truth  ·  kubelet = OS-level systemd binary',
  yaml: `# kubelet — systemd binary, OS-level, not managed by K8s
systemctl status kubelet

# kube-proxy — DaemonSet Pod
kubectl get ds kube-proxy -n kube-system

# apiserver / etcd / scheduler / controller-manager
# kubeadm install → Static Pod, manifests here:
ls /etc/kubernetes/manifests/
# kube-apiserver.yaml  etcd.yaml
# kube-scheduler.yaml  kube-controller-manager.yaml`,
  bounds: [
    { label: 'Control Plane  (Master Node)', x:   8, y: 56, w: 214, h: 274, style: 'node',    labelPos: 'top' },
    { label: 'Data Plane  (Worker Node ×N)', x: 230, y: 56, w: 302, h: 274, style: 'ns-game', labelPos: 'top' },
  ],
  blocks: [
    { label: 'kubectl',            sub: 'user / CI pipeline',     x:  62, y:   6, w: 104, h: 34, kind: 'external' },
    { label: 'kube-apiserver',     sub: 'REST API  :6443',        x:  16, y:  82, w: 198, h: 42, kind: 'service'  },
    { label: 'etcd',               sub: 'cluster state store',    x:  16, y: 142, w: 198, h: 42, kind: 'external' },
    { label: 'kube-scheduler',     sub: 'picks Node for Pod',     x:  16, y: 202, w: 198, h: 42, kind: 'external' },
    { label: 'controller-manager', sub: 'ReplicaSet / Endpoints', x:  16, y: 262, w: 198, h: 42, kind: 'external' },
    { label: 'kubelet',            sub: 'manages Pod lifecycle',  x: 238, y:  82, w: 284, h: 42, kind: 'service'  },
    { label: 'kube-proxy',         sub: 'iptables / ipvs rules',  x: 238, y: 142, w: 284, h: 42, kind: 'service'  },
    { label: 'containerd',         sub: 'CRI runtime (via runc)', x: 238, y: 202, w: 284, h: 42, kind: 'node'     },
    { label: 'Pod', sub: '10.244.x.x', x: 238, y: 268, w: 86, h: 42, kind: 'pod' },
    { label: 'Pod', sub: '10.244.x.x', x: 334, y: 268, w: 86, h: 42, kind: 'pod' },
    { label: 'Pod', sub: '10.244.x.x', x: 430, y: 268, w: 86, h: 42, kind: 'pod' },
  ],
  edges: [
    { x1: 114, y1: 40,  x2: 114, y2:  82 },   // kubectl → API Server
    { x1: 114, y1: 124, x2: 114, y2: 142 },   // API Server → etcd
    { x1: 214, y1: 103, x2: 238, y2: 103 },   // API Server → kubelet (watch)
    { x1: 214, y1: 103, x2: 238, y2: 163, bend: true },  // API Server → kube-proxy (watch)
    { x1: 380, y1: 244, x2: 380, y2: 268 },   // containerd → Pods
  ],
};

// ── Scenario A: kubectl apply ────────────────────────────────────────────────
// Deploying a new version of game-api

const SCENARIODEPLOY: NetDiagram = {
  svgW: 300, svgH: 540,
  steps: [
    '① kubectl apply → API Server validates manifest and writes to etcd',
    '② Scheduler detects unscheduled Pod → picks Node 2 (sufficient resources)',
    '③ API Server updates Pod.spec.nodeName = node-2',
    '④ Node 2 kubelet watches and sees the new Pod → calls containerd',
    '⑤ containerd pulls image, runc starts container, CNI assigns Pod IP',
    '⑥ Endpoints controller adds new Pod IP to game-api Endpoints',
    '⑦ kube-proxy updates iptables on all Nodes, traffic can reach the Pod',
  ],
  ip: 'kubectl apply → (seconds later) → Pod Running + iptables ready',
  yaml: `kubectl apply -f game-api.yaml
kubectl get pod -w              # Pending → Running
kubectl get endpoints game-api  # Pod IP added to Endpoints`,
  bounds: [
    { label: 'Control Plane', x: 5, y:  56, w: 290, h: 270, style: 'node',    labelPos: 'top' },
    { label: 'Worker Node 2', x: 5, y: 336, w: 290, h: 196, style: 'ns-game', labelPos: 'top' },
  ],
  blocks: [
    { label: 'kubectl',          sub: 'apply game-api.yaml',        x: 50, y:   8, w: 200, h: 38, kind: 'external' },
    { label: 'API Server',       sub: '① validate + write etcd',    x: 50, y:  90, w: 200, h: 38, kind: 'service'  },
    { label: 'etcd',             sub: 'desired state stored',        x: 50, y: 144, w: 200, h: 38, kind: 'external' },
    { label: 'Scheduler',        sub: '② picks Node 2',             x: 50, y: 198, w: 200, h: 38, kind: 'external' },
    { label: 'API Server',       sub: '③ nodeName = node-2',        x: 50, y: 252, w: 200, h: 38, kind: 'service'  },
    { label: 'kubelet',          sub: '④ watch → sees new Pod',     x: 50, y: 370, w: 200, h: 38, kind: 'service'  },
    { label: 'containerd + CNI', sub: '⑤ pull image / assign IP',   x: 50, y: 420, w: 200, h: 38, kind: 'node'     },
    { label: 'game-api Pod',     sub: '⑥⑦ Ready  10.244.2.x:3000', x: 50, y: 470, w: 200, h: 46, kind: 'pod'      },
  ],
  edges: [
    { x1: 150, y1: 46,  x2: 150, y2:  90 },
    { x1: 150, y1: 128, x2: 150, y2: 144 },
    { x1: 150, y1: 182, x2: 150, y2: 198 },
    { x1: 150, y1: 236, x2: 150, y2: 252 },
    { x1: 150, y1: 290, x2: 150, y2: 370 },
    { x1: 150, y1: 408, x2: 150, y2: 420 },
    { x1: 150, y1: 458, x2: 150, y2: 470 },
  ],
};

// ── Scenario B: Pod crash recovery ───────────────────────────────────────────
// game-api Pod OOM, ReplicaSet automatically replaces it

const SCENARIOCRASH: NetDiagram = {
  svgW: 300, svgH: 480,
  steps: [
    '① game-api Pod OOM / process exit → container exits',
    '② kubelet detects container is gone (exit code / liveness probe)',
    '③ kubelet reports Pod status = Failed to API Server',
    '④ ReplicaSet controller detects current < desired → creates new Pod',
    '⑤ Scheduler picks a Node (may be same or different)',
    '⑥ Target Node kubelet → containerd starts new container',
    '⑦ Endpoints updated, kube-proxy rewrites iptables, traffic reaches new Pod',
  ],
  ip: 'Self-healing: crashed Pod to new Pod Ready, typically < 30 seconds',
  yaml: `kubectl get pod -w            # CrashLoopBackOff → Running
kubectl describe pod <name>   # restart count + reason
kubectl get events            # scheduler / kubelet events`,
  bounds: [
    { label: 'Worker Node',   x: 5, y:   5, w: 290, h: 118, style: 'ns-game', labelPos: 'top' },
    { label: 'Control Plane', x: 5, y: 132, w: 290, h: 198, style: 'node',    labelPos: 'top' },
  ],
  blocks: [
    { label: 'game-api Pod',      sub: '① OOM / exit',             x: 50, y:  28, w: 200, h: 38, kind: 'pod'      },
    { label: 'kubelet',           sub: '② detects crash',           x: 50, y:  78, w: 200, h: 38, kind: 'service'  },
    { label: 'API Server',        sub: '③ Pod status = Failed',     x: 50, y: 162, w: 200, h: 38, kind: 'service'  },
    { label: 'ReplicaSet Ctrl',   sub: '④ current < desired',       x: 50, y: 212, w: 200, h: 38, kind: 'external' },
    { label: 'Scheduler',         sub: '⑤ picks Node',              x: 50, y: 262, w: 200, h: 38, kind: 'external' },
    { label: 'kubelet (new)',      sub: '⑥ containerd starts Pod',  x: 50, y: 352, w: 200, h: 38, kind: 'service'  },
    { label: 'game-api Pod (new)', sub: '⑦ 10.244.y.y:3000  Ready',x: 50, y: 410, w: 200, h: 46, kind: 'pod'      },
  ],
  edges: [
    { x1: 150, y1: 66,  x2: 150, y2:  78 },
    { x1: 150, y1: 116, x2: 150, y2: 162 },
    { x1: 150, y1: 200, x2: 150, y2: 212 },
    { x1: 150, y1: 250, x2: 150, y2: 262 },
    { x1: 150, y1: 300, x2: 150, y2: 352 },
    { x1: 150, y1: 390, x2: 150, y2: 410 },
  ],
};

// ── Scenario C: External traffic ─────────────────────────────────────────────
// Player connects to maple.game.com, full packet path to Pod

const SCENARIOTRAFFIC: NetDiagram = {
  svgW: 300, svgH: 510,
  steps: [
    '① Player opens maple.game.com in browser',
    '② DNS resolves → cloud LB external IP (203.0.x.x)',
    '③ LB picks a Node, forwards to NodePort (Node:32080)',
    '④ Node iptables (set by kube-proxy) DNAT → Ingress Pod IP',
    '⑤ Ingress Controller routes /api/* → game-api Service',
    '⑥ iptables DNAT: ClusterIP 10.96.x.x → selected game-api Pod IP',
    '⑦ CNI overlay routes packet to the Pod on the target Node',
  ],
  ip: 'full data plane path: LB → iptables → Ingress → DNAT → CNI → Pod',
  yaml: `curl -v https://maple.game.com/api/status

# inspect iptables DNAT rules
iptables -t nat -L KUBE-SERVICES -n`,
  bounds: [
    { label: 'Kubernetes cluster', x: 5, y: 178, w: 290, h: 330, style: 'node', labelPos: 'top' },
  ],
  blocks: [
    { label: 'Player Browser', sub: '① maple.game.com',              x: 50, y:  10, w: 200, h: 38, kind: 'external' },
    { label: 'DNS',            sub: '② maple.game.com → 203.0.x.x', x: 50, y:  68, w: 200, h: 38, kind: 'external' },
    { label: 'Cloud LB',       sub: '③ 203.0.x.x → Node:32080',     x: 50, y: 126, w: 200, h: 38, kind: 'external' },
    { label: 'iptables (Node)',sub: '④ DNAT → Ingress Pod IP',       x: 50, y: 208, w: 200, h: 38, kind: 'service'  },
    { label: 'Ingress Pod',    sub: '⑤ /api/* → game-api',          x: 50, y: 266, w: 200, h: 38, kind: 'pod'      },
    { label: 'iptables (DNAT)',sub: '⑥ ClusterIP → Pod IP',          x: 50, y: 324, w: 200, h: 38, kind: 'service'  },
    { label: 'CNI overlay',    sub: '⑦ route to target Node',        x: 50, y: 382, w: 200, h: 38, kind: 'node'     },
    { label: 'game-api Pod',   sub: '10.244.y.y:3000',               x: 50, y: 440, w: 200, h: 46, kind: 'pod'      },
  ],
  edges: [
    { x1: 150, y1:  48, x2: 150, y2:  68 },
    { x1: 150, y1: 106, x2: 150, y2: 126 },
    { x1: 150, y1: 164, x2: 150, y2: 208 },
    { x1: 150, y1: 246, x2: 150, y2: 266 },
    { x1: 150, y1: 304, x2: 150, y2: 324 },
    { x1: 150, y1: 362, x2: 150, y2: 382 },
    { x1: 150, y1: 420, x2: 150, y2: 440 },
  ],
};

// ── Pod lifecycle: spec → kubelet → runc → process ───────────────────────────
// Two worlds meet: K8s object world (etcd spec) and container execution world (OS process)

const PODLIFECYCLE: NetDiagram = {
  svgW: 300, svgH: 510,
  steps: [
    'Deployment / ReplicaSet only write spec to etcd — they have no idea how containers actually run',
    'Pod spec is just data in etcd; it becomes meaningful only after Scheduler writes nodeName',
    'kubelet is the bridge: watches API Server for Pods assigned to its Node',
    'kubelet calls containerd via CRI, instructing it to run the spec',
    'containerd calls runc, which forks the actual OS process',
    'runc sets up Linux namespaces (PID / net / mnt) and cgroups (CPU / mem limits)',
    'container = process + isolation + resource limits — that is what "running" really means',
  ],
  ip: 'Pod spec (data in etcd) → kubelet (bridge) → runc (OS process)',
  yaml: `# Pod spec is just data — kubelet brings it to life
kubectl get pod game-api-0 -o yaml   # inspect spec
kubectl describe pod game-api-0       # inspect kubelet events
crictl ps                             # containers as seen by containerd
runc list                             # containers as seen by runc`,
  bounds: [
    { label: 'K8s Object World  (etcd)',          x: 5, y:  10, w: 290, h: 210, style: 'node',    labelPos: 'top' },
    { label: 'Container Execution World  (OS)',    x: 5, y: 298, w: 290, h: 200, style: 'ns-game', labelPos: 'top' },
  ],
  blocks: [
    { label: 'Deployment',   sub: 'your entry point',              x: 50, y:  40, w: 200, h: 38, kind: 'external' },
    { label: 'ReplicaSet',   sub: 'ensures N Pod specs exist',     x: 50, y:  96, w: 200, h: 38, kind: 'external' },
    { label: 'Pod spec',     sub: 'data in etcd, not yet running', x: 50, y: 152, w: 200, h: 38, kind: 'service'  },
    { label: 'kubelet',      sub: 'bridge — watches spec, calls CRI', x: 50, y: 244, w: 200, h: 44, kind: 'service'  },
    { label: 'containerd',   sub: 'CRI runtime, manages containers', x: 50, y: 330, w: 200, h: 38, kind: 'node'     },
    { label: 'runc',         sub: 'OCI runtime, forks OS process',  x: 50, y: 386, w: 200, h: 38, kind: 'node'     },
    { label: 'container',    sub: 'process + namespaces + cgroups', x: 50, y: 442, w: 200, h: 46, kind: 'pod'      },
  ],
  edges: [
    { x1: 150, y1:  78, x2: 150, y2:  96 },
    { x1: 150, y1: 134, x2: 150, y2: 152 },
    { x1: 150, y1: 190, x2: 150, y2: 244 },
    { x1: 150, y1: 288, x2: 150, y2: 330, label: 'CRI'  },
    { x1: 150, y1: 368, x2: 150, y2: 386, label: 'exec' },
    { x1: 150, y1: 424, x2: 150, y2: 442 },
  ],
};

// ── Workload types side by side ──────────────────────────────────────────────
// Three Nodes: DaemonSet (one per Node), Deployment (Scheduler-placed), StatefulSet (stable identity)

const WORKLOADTYPES: NetDiagram = {
  svgW: 536, svgH: 285,
  steps: [
    'DaemonSet: one Pod per Node, count cannot be set (kube-proxy, fluentd, CNI plugin)',
    'Deployment: you set replicas=3, Deployment creates a ReplicaSet, ReplicaSet creates the Pods',
    'ReplicaSet: implementation detail, keeps exactly N Pods alive — users rarely interact with it directly',
    'StatefulSet: Pods have stable identities (postgres-0, postgres-1), name persists across restarts',
    'DaemonSet Pods co-exist with app workloads on the same Node, each consuming CPU/Memory',
    'postgres has 2 replicas → Node C has no StatefulSet Pod',
  ],
  ip: 'Node = shared machine  ·  workload type only affects scheduling, not co-location',
  yaml: `# DaemonSet — one per Node
kind: DaemonSet
# Deployment — Scheduler decides placement
kind: Deployment
spec:
  replicas: 3
# StatefulSet — stable identity
kind: StatefulSet
spec:
  replicas: 2   # postgres-0, postgres-1`,
  bounds: [
    { label: 'Node A', x:   8, y: 20, w: 160, h: 245, style: 'ns-game', labelPos: 'top' },
    { label: 'Node B', x: 188, y: 20, w: 160, h: 245, style: 'ns-game', labelPos: 'top' },
    { label: 'Node C', x: 368, y: 20, w: 160, h: 245, style: 'ns-game', labelPos: 'top' },
  ],
  blocks: [
    // Node A
    { label: 'kube-proxy', sub: 'DaemonSet', x:  16, y:  50, w: 144, h: 36, kind: 'node'    },
    { label: 'fluentd',    sub: 'DaemonSet', x:  16, y:  96, w: 144, h: 36, kind: 'node'    },
    { label: 'game-api-0', sub: 'Deployment → ReplicaSet', x:  16, y: 152, w: 144, h: 36, kind: 'pod'     },
    { label: 'postgres-0', sub: 'StatefulSet',             x:  16, y: 200, w: 144, h: 36, kind: 'service' },
    // Node B
    { label: 'kube-proxy', sub: 'DaemonSet', x: 196, y:  50, w: 144, h: 36, kind: 'node'    },
    { label: 'fluentd',    sub: 'DaemonSet', x: 196, y:  96, w: 144, h: 36, kind: 'node'    },
    { label: 'game-api-1', sub: 'Deployment → ReplicaSet', x: 196, y: 152, w: 144, h: 36, kind: 'pod'     },
    { label: 'postgres-1', sub: 'StatefulSet',             x: 196, y: 200, w: 144, h: 36, kind: 'service' },
    // Node C
    { label: 'kube-proxy', sub: 'DaemonSet', x: 376, y:  50, w: 144, h: 36, kind: 'node'    },
    { label: 'fluentd',    sub: 'DaemonSet', x: 376, y:  96, w: 144, h: 36, kind: 'node'    },
    { label: 'game-api-2', sub: 'Deployment → ReplicaSet', x: 376, y: 152, w: 144, h: 36, kind: 'pod'     },
    // Node C has no StatefulSet Pod (replicas=2, postgres-0/1 on A/B)
  ],
  edges: [],
};

// ── CRI / CNI / CSI / OCI interfaces ─────────────────────────────────────────

const INTERFACES: NetDiagram = {
  svgW: 0, svgH: 0,
  svgHide: true,
  steps: [
    'These are interface specs, not inheritance. Implement the required methods/behavior and you conform.',
    'Go interface philosophy: no "implements" keyword, duck typing — if you can do these things, you are it',
    'Official K8s acceptance: implement → PR to k8s/enhancements → conformance test → listed in docs',
    'OCI image + runtime spec lets any runtime run any image, no vendor lock-in',
  ],
  ip: 'CRI / CNI / CSI = K8s plugin interfaces  ·  OCI = cross-platform container standard',
  yaml: `# verify CRI implementation (containerd)
crictl info

# verify CNI implementation (call Calico binary directly)
CNI_COMMAND=ADD /opt/cni/bin/calico < /etc/cni/net.d/10-calico.conf

# verify CSI (list CSI drivers)
kubectl get csidrivers`,
  bounds: [], blocks: [], edges: [],
  table: {
    cols: ['Interface', 'Required methods', 'Implementations'],
    rows: [
      ['CRI\n(Container Runtime Interface)',
       'RunPodSandbox / CreateContainer\nStartContainer / StopContainer\nListContainers / ExecSync\n(gRPC service)',
       'containerd\nCRI-O'],
      ['CNI\n(Container Network Interface)',
       'ADD — configure Pod network interface\nDEL — clean up network config\nCHECK — verify config is correct\n(CLI binary + JSON config)',
       'Calico\nFlannel\nCilium'],
      ['CSI\n(Container Storage Interface)',
       'CreateVolume / DeleteVolume\nControllerPublishVolume (attach)\nNodeStageVolume (mount on Node)\nNodePublishVolume (mount in Pod)\n(gRPC service)',
       'AWS EBS CSI\nGCP PD CSI\nCeph RBD'],
      ['OCI Image Spec',
       'image manifest (JSON)\nlayer tar archives\nconfig (env, entrypoint...)',
       'Docker\nBuildah\npodman build'],
      ['OCI Runtime Spec',
       'config.json (container spec)\nLifecycle: create → start → kill → delete\n(implementable in any language)',
       'runc (Go)\ncrun (C)\nkata-containers\ngVisor'],
    ],
  },
};

export const NETWORK_DIAGRAMS: Record<NetworkType, NetDiagram> = {
  ClusterIP:       CLUSTERIP,
  NodePort:        NODEPORT,
  LoadBalancer:    LOADBALANCER,
  NodeNamespace:   NODENAMESPACE,
  Ingress:         INGRESS,
  Gateway:         GATEWAY,
  ProxyMode:       PROXYMODE,
  MasterWorker:    MASTERWORKER,
  ScenarioDeploy:  SCENARIODEPLOY,
  ScenarioCrash:   SCENARIOCRASH,
  ScenarioTraffic: SCENARIOTRAFFIC,
  Interfaces:      INTERFACES,
  WorkloadTypes:   WORKLOADTYPES,
  PodLifecycle:    PODLIFECYCLE,
};

// ── Component ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-network-patterns',
  standalone: true,
  imports: [NgClass],
  templateUrl: './network-patterns.component.html',
  styleUrl: './network-patterns.component.scss',
})
export class NetworkPatternsComponent {
  readonly type = input.required<NetworkType>();
  readonly diagram = computed(() => NETWORK_DIAGRAMS[this.type()]);

  edgePath(e: NetEdge): string {
    if (e.bend) {
      return `M ${e.x1} ${e.y1} C ${e.x1} ${e.y2} ${e.x2} ${e.y1} ${e.x2} ${e.y2}`;
    }
    return `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`;
  }

  textY(b: NetBlock): number {
    return b.sub ? b.y + b.h / 2 - 6 : b.y + b.h / 2 + 5;
  }

  boundLabelY(b: NetBound): number {
    return b.labelPos === 'top' ? b.y + 14 : b.y + b.h - 10;
  }

  edgeMidX(e: NetEdge): number { return (e.x1 + e.x2) / 2; }
  edgeMidY(e: NetEdge): number { return (e.y1 + e.y2) / 2 - 6; }
}
