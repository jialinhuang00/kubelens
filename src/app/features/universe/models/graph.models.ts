export type K8sResourceKind =
  | 'Namespace'
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'CronJob'
  | 'Pod'
  | 'Service'
  | 'ConfigMap'
  | 'Secret'
  | 'ServiceAccount'
  | 'PersistentVolumeClaim'
  | 'Gateway'
  | 'HTTPRoute'
  | 'TCPRoute'
  | 'Ingress'
  | 'HorizontalPodAutoscaler'
  | 'NetworkPolicy'
  | 'Role'
  | 'RoleBinding'
  | 'PodDisruptionBudget';

export type ResourceCategory = 'namespace' | 'workload' | 'abstract' | 'storage' | 'rbac';

export type RelationshipType =
  | 'uses-configmap'
  | 'uses-secret'
  | 'uses-pvc'
  | 'uses-serviceaccount'
  | 'exposes'
  | 'routes-to'
  | 'binds-role'
  | 'parent-gateway'
  | 'owns';

export interface GraphNode {
  id: string;
  name: string;
  kind: K8sResourceKind;
  category: ResourceCategory;
  namespace: string;
  metadata: Record<string, unknown> & { orphan?: boolean };
}

export interface GraphEdge {
  source: string;
  target: string;
  type: RelationshipType;
  sourceField?: string;
}

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

export const KIND_COLORS: Record<K8sResourceKind, string> = {
  // Namespace — cyan anchor
  Namespace: '#00d4ff',
  // Workload — green family (runs containers)
  Deployment: '#39e060',
  StatefulSet: '#50e680',
  DaemonSet: '#2db84d',
  CronJob: '#66b333',
  Pod: '#88cc88',
  // Abstract — grayscale (routes traffic, config, policy — not a workload)
  Service: '#d0d0d0',
  Gateway: '#b0b0b0',
  HTTPRoute: '#a0a0a0',
  TCPRoute: '#a0a0a0',
  Ingress: '#c0c0c0',
  NetworkPolicy: '#909090',
  ConfigMap: '#b8b8b8',
  Secret: '#cccccc',
  HorizontalPodAutoscaler: '#999999',
  PodDisruptionBudget: '#888888',
  // Storage — amber/gold
  PersistentVolumeClaim: '#e6a817',
  // RBAC — blue-violet scale
  ServiceAccount: '#7c6aef',
  Role: '#9b7aff',
  RoleBinding: '#6a5acd',
};

export const EDGE_COLORS: Record<RelationshipType, string> = {
  'uses-configmap': '#b8b8b8',
  'uses-secret': '#cccccc',
  'uses-pvc': '#e6a817',
  'uses-serviceaccount': '#7c6aef',
  'exposes': '#d0d0d0',
  'routes-to': '#a0a0a0',
  'binds-role': '#9b7aff',
  'parent-gateway': '#b0b0b0',
  'owns': '#88cc88',
};

export const CATEGORY_SIZES: Record<ResourceCategory, number> = {
  namespace: 30,
  workload: 8,
  abstract: 6,
  storage: 6,
  rbac: 5,
};

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  namespace: 'Namespace',
  workload: 'Workload',
  abstract: 'Abstract',
  storage: 'Storage',
  rbac: 'RBAC',
};

export const CATEGORY_ORDER: ResourceCategory[] = [
  'workload', 'abstract', 'storage', 'rbac', 'namespace',
];

export function getCategory(kind: K8sResourceKind): ResourceCategory {
  switch (kind) {
    case 'Namespace':
      return 'namespace';
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'CronJob':
    case 'Pod':
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
