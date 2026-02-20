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

export const KIND_COLORS: Record<NodeKind, string> = {
  // Namespace — soft amber anchor
  Namespace: '#e8b866',
  // Workload — muted jade family (runs containers)
  Deployment: '#6dca82',
  StatefulSet: '#7dd492',
  DaemonSet: '#5ab86d',
  CronJob: '#8cb866',
  Pod: '#88cc88',
  ReplicaSet: '#78c488',
  Job: '#82be78',
  // Abstract — warm grayscale (routes traffic, config, policy — not a workload)
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
  // Storage — sand coral
  PersistentVolumeClaim: '#d4956a',
  // RBAC — warm gold scale
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
