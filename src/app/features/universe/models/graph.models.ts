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
  // Namespace — soft amber anchor
  Namespace: '#e8b866',
  // Workload — muted jade family (runs containers)
  Deployment: '#6dca82',
  StatefulSet: '#7dd492',
  DaemonSet: '#5ab86d',
  CronJob: '#8cb866',
  Pod: '#88cc88',
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

export const EDGE_COLORS: Record<RelationshipType, string> = {
  'uses-configmap': '#b8b0a0',
  'uses-secret': '#ccc4b4',
  'uses-pvc': '#d4956a',
  'uses-serviceaccount': '#c8a060',
  'exposes': '#d0c8b8',
  'routes-to': '#a09888',
  'binds-role': '#f0d080',
  'parent-gateway': '#b0a898',
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
