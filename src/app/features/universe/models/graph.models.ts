export {
  type NodeKind, type NodeCategory, PodPhase,
  EdgeType, SourceField,
  type GraphNode, type GraphEdge, type PodNode, type GraphResult,
} from '../../../../../shared/graph-types';

import {
  type NodeKind, type NodeCategory, PodPhase, EdgeType,
  type GraphNode, type GraphEdge, type PodNode,
} from '../../../../../shared/graph-types';

export interface GraphDataResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pods: Record<string, GraphNode[]>;
  namespaces: string[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    byKind: Record<string, number>;
    namespaceCount: number;
  };
}

// ---- Helpers to shift hex color brightness ----
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

function shiftBrightness(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---- Read theme tokens and build full palette ----
export function getThemedKindColors(): Record<NodeKind, string> {
  const ns = getCssVar('--t-kind-namespace') || '#e8b866';
  const wk = getCssVar('--t-kind-workload') || '#6dca82';
  const net = getCssVar('--t-kind-network') || '#d0c8b8';
  const cfg = getCssVar('--t-kind-config') || '#b8b0a0';
  const sto = getCssVar('--t-kind-storage') || '#d4956a';
  const rbac = getCssVar('--t-kind-rbac') || '#c8a060';

  return {
    Namespace: ns,
    // Workload family — variations around the base
    Deployment: wk,
    StatefulSet: shiftBrightness(wk, 1.1),
    DaemonSet: shiftBrightness(wk, 0.85),
    CronJob: shiftBrightness(wk, 0.95),
    Pod: shiftBrightness(wk, 1.05),
    ReplicaSet: shiftBrightness(wk, 0.92),
    Job: shiftBrightness(wk, 0.88),
    // Network / abstract — Service and routing use `net`, config uses `cfg`
    Service: net,
    Gateway: shiftBrightness(net, 0.85),
    HTTPRoute: shiftBrightness(net, 0.78),
    TCPRoute: shiftBrightness(net, 0.78),
    Ingress: shiftBrightness(net, 0.92),
    NetworkPolicy: shiftBrightness(net, 0.7),
    ConfigMap: cfg,
    Secret: shiftBrightness(cfg, 1.1),
    HorizontalPodAutoscaler: shiftBrightness(net, 0.75),
    PodDisruptionBudget: shiftBrightness(net, 0.68),
    // Storage
    PersistentVolumeClaim: sto,
    // RBAC
    ServiceAccount: rbac,
    Role: shiftBrightness(rbac, 1.2),
    RoleBinding: shiftBrightness(rbac, 0.88),
  };
}

export function getThemedEdgeColors(): Record<EdgeType, string> {
  const cfg = getCssVar('--t-kind-config') || '#b8b0a0';
  const net = getCssVar('--t-kind-network') || '#d0c8b8';
  const sto = getCssVar('--t-kind-storage') || '#d4956a';
  const rbac = getCssVar('--t-kind-rbac') || '#c8a060';
  const wk = getCssVar('--t-kind-workload') || '#6dca82';

  return {
    [EdgeType.UsesConfigMap]: cfg,
    [EdgeType.UsesSecret]: shiftBrightness(cfg, 1.1),
    [EdgeType.UsesPVC]: sto,
    [EdgeType.UsesServiceAccount]: rbac,
    [EdgeType.Exposes]: net,
    [EdgeType.RoutesTo]: shiftBrightness(net, 0.78),
    [EdgeType.BindsRole]: shiftBrightness(rbac, 1.2),
    [EdgeType.ParentGateway]: shiftBrightness(net, 0.85),
    [EdgeType.Owns]: shiftBrightness(wk, 1.05),
  };
}

// Static fallback (used by sidebar legend which doesn't need runtime read)
export const KIND_COLORS: Record<NodeKind, string> = {
  Namespace: '#e8b866',
  Deployment: '#6dca82',
  StatefulSet: '#7dd492',
  DaemonSet: '#5ab86d',
  CronJob: '#8cb866',
  Pod: '#88cc88',
  ReplicaSet: '#78c488',
  Job: '#82be78',
  Service: '#d0c8b8',
  Gateway: '#b0a898',
  HTTPRoute: '#a09888',
  TCPRoute: '#a09888',
  Ingress: '#c0b8a8',
  NetworkPolicy: '#908878',
  ConfigMap: '#b8b0a0',
  Secret: '#ccc4b4',
  HorizontalPodAutoscaler: '#998878',
  PodDisruptionBudget: '#888070',
  PersistentVolumeClaim: '#d4956a',
  ServiceAccount: '#c8a060',
  Role: '#f0d080',
  RoleBinding: '#b89050',
};

export const EDGE_COLORS: Record<EdgeType, string> = {
  [EdgeType.UsesConfigMap]: '#b8b0a0',
  [EdgeType.UsesSecret]: '#ccc4b4',
  [EdgeType.UsesPVC]: '#d4956a',
  [EdgeType.UsesServiceAccount]: '#c8a060',
  [EdgeType.Exposes]: '#d0c8b8',
  [EdgeType.RoutesTo]: '#a09888',
  [EdgeType.BindsRole]: '#f0d080',
  [EdgeType.ParentGateway]: '#b0a898',
  [EdgeType.Owns]: '#88cc88',
};

export const CATEGORY_SIZES: Record<NodeCategory, number> = {
  namespace: 30,
  workload: 8,
  abstract: 6,
  storage: 6,
  rbac: 5,
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  namespace: 'Namespace',
  workload: 'Workload',
  abstract: 'Abstract',
  storage: 'Storage',
  rbac: 'RBAC',
};

export const CATEGORY_ORDER: NodeCategory[] = [
  'workload', 'abstract', 'storage', 'rbac', 'namespace',
];

export const POD_STATUS_COLORS: Record<PodPhase, string> = {
  [PodPhase.Running]: '#6dca82',
  [PodPhase.Succeeded]: '#6dca82',
  [PodPhase.Pending]: '#d4956a',
  [PodPhase.Failed]: '#e07070',
  [PodPhase.Unknown]: '#e07070',
  [PodPhase.CrashLoopBackOff]: '#e07070',
};

export function getCategory(kind: NodeKind): NodeCategory {
  switch (kind) {
    case 'Namespace':
      return 'namespace';
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'CronJob':
    case 'Pod':
    case 'ReplicaSet':
    case 'Job':
      return 'workload';
    case 'Service':
    case 'Gateway':
    case 'HTTPRoute':
    case 'TCPRoute':
    case 'Ingress':
    case 'NetworkPolicy':
    case 'ConfigMap':
    case 'Secret':
    case 'HorizontalPodAutoscaler':
    case 'PodDisruptionBudget':
      return 'abstract';
    case 'PersistentVolumeClaim':
      return 'storage';
    case 'ServiceAccount':
    case 'Role':
    case 'RoleBinding':
      return 'rbac';
  }
}
