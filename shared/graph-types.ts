/**
 * Shared K8s graph type definitions.
 * Used by both server (utils/graph-builder) and frontend (universe feature).
 */

/** K8s API kind names — official K8s resource types. */
export type NodeKind =
  | 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob'
  | 'Service' | 'ConfigMap' | 'Secret' | 'Ingress'
  | 'ServiceAccount' | 'RoleBinding' | 'Role'
  | 'PersistentVolumeClaim' | 'HorizontalPodAutoscaler'
  | 'Gateway' | 'HTTPRoute' | 'TCPRoute'
  | 'Pod' | 'ReplicaSet' | 'Job'
  | 'Namespace' | 'NetworkPolicy' | 'PodDisruptionBudget';

/**
 * Graph node categories — our own grouping for visual styling.
 * - namespace: the namespace container itself
 * - workload: resources that manage Pods (Deployment, StatefulSet, etc.)
 * - abstract: supporting resources (Service, ConfigMap, Secret, Ingress, etc.)
 * - rbac: access control resources (Role, RoleBinding, ServiceAccount)
 * - storage: persistent storage (PVC)
 */
export type NodeCategory = 'namespace' | 'workload' | 'abstract' | 'rbac' | 'storage';

/**
 * Edge relationship types — our own naming for how resources connect.
 * - uses-configmap: Workload references a ConfigMap (env or volume)
 * - uses-secret: Workload references a Secret (env or volume)
 * - uses-pvc: Workload mounts a PersistentVolumeClaim
 * - uses-serviceaccount: Workload runs as a ServiceAccount
 * - exposes: Service selects a Workload, or HPA targets a Workload
 * - routes-to: HTTPRoute/TCPRoute/Ingress forwards traffic to a Service
 * - parent-gateway: HTTPRoute/TCPRoute attaches to a Gateway
 * - binds-role: RoleBinding references a Role or ServiceAccount
 * - owns: parent owns child resource
 */
export enum EdgeType {
  UsesConfigMap      = 'uses-configmap',      // Workload → ConfigMap (env or volume)
  UsesSecret         = 'uses-secret',         // Workload → Secret (env or volume)
  UsesPVC            = 'uses-pvc',            // Workload → PVC
  UsesServiceAccount = 'uses-serviceaccount', // Workload → ServiceAccount
  Exposes            = 'exposes',             // Service → Workload, HPA → Workload
  RoutesTo           = 'routes-to',           // HTTPRoute/TCPRoute/Ingress → Service
  ParentGateway      = 'parent-gateway',      // HTTPRoute/TCPRoute → Gateway
  BindsRole          = 'binds-role',          // RoleBinding → Role/ServiceAccount
  Owns               = 'owns',               // Parent → child resource
}

/** K8s Pod phase values, plus derived display statuses (e.g. CrashLoopBackOff). */
export enum PodPhase {
  Pending          = 'Pending',
  Running          = 'Running',
  Succeeded        = 'Succeeded',
  Failed           = 'Failed',
  Unknown          = 'Unknown',
  CrashLoopBackOff = 'CrashLoopBackOff',
}

/** YAML field paths that create edges between K8s resources. */
export enum SourceField {
  ServiceAccountName = 'spec.serviceAccountName',
  EnvFromConfigMap   = 'envFrom.configMapRef',
  EnvFromSecret      = 'envFrom.secretRef',
  EnvConfigMapKey    = 'env.valueFrom.configMapKeyRef',
  EnvSecretKey       = 'env.valueFrom.secretKeyRef',
  VolumePVC          = 'volumes.persistentVolumeClaim',
  VolumeConfigMap    = 'volumes.configMap',
  VolumeSecret       = 'volumes.secret',
  ProjectedConfigMap = 'volumes.projected.configMap',
  ProjectedSecret    = 'volumes.projected.secret',
  Selector           = 'spec.selector',
  ParentRefs         = 'spec.parentRefs',
  BackendRefs        = 'spec.rules.backendRefs',
  IngressBackend     = 'spec.rules.http.paths.backend',
  IngressTLS         = 'spec.tls.secretName',
  ScaleTargetRef     = 'spec.scaleTargetRef',
  RoleRef            = 'roleRef',
  Subjects           = 'subjects',
  OwnerReference     = 'metadata.ownerReferences',
}

/** A node in the K8s resource topology graph. */
export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  category: NodeCategory;
  namespace: string;
  metadata: Record<string, unknown>;
}

/** A directed edge in the topology graph (e.g. Service → Deployment). */
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  sourceField?: SourceField;
}

export interface PodNode extends GraphNode {
  metadata: {
    status: PodPhase;
    ownerKind: string;
    ownerName: string;
    image?: string;
    containers?: string[];
    node?: string;
    restarts: number;
    [key: string]: unknown;
  };
}

/** Complete graph output from buildGraph(). */
export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pods: Record<string, PodNode[]>;
  namespaces: string[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    byKind: Record<string, number>;
    namespaceCount: number;
  };
}
