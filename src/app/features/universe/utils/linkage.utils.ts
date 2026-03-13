import { GraphNode, GraphEdge, SourceField, NodeKind } from '../models/graph.models';
import { FIELD_BASE } from '../../../shared/models/field-base';

// ── Constants ────────────────────────────────────────────────────────────────

export const LINKAGE_KINDS: NodeKind[] = [
  'Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job',
  'Service', 'Ingress', 'HTTPRoute', 'TCPRoute', 'RoleBinding', 'Pod',
];

export const KIND_DIRECTION_HINTS: Record<string, { out: string; in: string }> = {
  Deployment:  { out: '→ ConfigMap · Secret · PVC · ServiceAccount', in: '← Service · HPA' },
  StatefulSet: { out: '→ ConfigMap · Secret · PVC · ServiceAccount', in: '← Service · HPA' },
  DaemonSet:   { out: '→ ConfigMap · Secret · ServiceAccount',       in: '← Service' },
  CronJob:     { out: '→ Job · ConfigMap · Secret · ServiceAccount', in: '(none typical)' },
  Job:         { out: '→ ConfigMap · Secret · ServiceAccount',       in: '← CronJob (owns)' },
  Service:     { out: '→ Pod / Deployment (selector)',               in: '← Ingress · HTTPRoute · TCPRoute' },
  Ingress:     { out: '→ Service · Secret (TLS)',                    in: '(none typical)' },
  HTTPRoute:   { out: '→ Service · Gateway (parentRef)',             in: '(none typical)' },
  TCPRoute:    { out: '→ Service · Gateway (parentRef)',             in: '(none typical)' },
  RoleBinding: { out: '→ Role · ServiceAccount (subjects)',          in: '(none typical)' },
  Pod:         { out: '→ ConfigMap · Secret · PVC · ServiceAccount', in: '← Deployment · StatefulSet · DaemonSet (ownerRef)' },
};

// ── Static fallback examples ─────────────────────────────────────────────────

const STATIC_OUTGOING: Partial<Record<NodeKind, Array<{ field: SourceField; tgtKind: NodeKind; tgtName: string }>>> = {
  Deployment: [
    { field: SourceField.ServiceAccountName, tgtKind: 'ServiceAccount',        tgtName: 'my-app-sa'   },
    { field: SourceField.EnvFromConfigMap,   tgtKind: 'ConfigMap',             tgtName: 'app-config'  },
    { field: SourceField.EnvSecretKey,       tgtKind: 'Secret',                tgtName: 'app-secret'  },
    { field: SourceField.VolumePVC,          tgtKind: 'PersistentVolumeClaim', tgtName: 'data-pvc'    },
  ],
  StatefulSet: [
    { field: SourceField.ServiceAccountName, tgtKind: 'ServiceAccount',        tgtName: 'my-app-sa'   },
    { field: SourceField.EnvConfigMapKey,    tgtKind: 'ConfigMap',             tgtName: 'app-config'  },
    { field: SourceField.EnvSecretKey,       tgtKind: 'Secret',                tgtName: 'db-secret'   },
    { field: SourceField.VolumePVC,          tgtKind: 'PersistentVolumeClaim', tgtName: 'data-pvc'    },
  ],
  DaemonSet: [
    { field: SourceField.ServiceAccountName, tgtKind: 'ServiceAccount', tgtName: 'node-agent-sa' },
    { field: SourceField.VolumeConfigMap,    tgtKind: 'ConfigMap',      tgtName: 'agent-config'  },
    { field: SourceField.EnvSecretKey,       tgtKind: 'Secret',         tgtName: 'agent-secret'  },
  ],
  CronJob: [
    { field: SourceField.ServiceAccountName, tgtKind: 'ServiceAccount', tgtName: 'job-sa'     },
    { field: SourceField.EnvFromConfigMap,   tgtKind: 'ConfigMap',      tgtName: 'job-config' },
    { field: SourceField.EnvSecretKey,       tgtKind: 'Secret',         tgtName: 'job-secret' },
  ],
  HTTPRoute: [
    { field: SourceField.ParentRefs,  tgtKind: 'Gateway', tgtName: 'my-gateway' },
    { field: SourceField.BackendRefs, tgtKind: 'Service',  tgtName: 'my-svc'    },
  ],
  TCPRoute: [
    { field: SourceField.ParentRefs,  tgtKind: 'Gateway', tgtName: 'my-gateway' },
    { field: SourceField.BackendRefs, tgtKind: 'Service',  tgtName: 'my-svc'    },
  ],
  RoleBinding: [
    { field: SourceField.RoleRef,    tgtKind: 'Role',           tgtName: 'my-role'   },
    { field: SourceField.Subjects,   tgtKind: 'ServiceAccount', tgtName: 'my-app-sa' },
  ],
};

const STATIC_INCOMING: Partial<Record<NodeKind, { field: SourceField; srcKind: NodeKind; srcName: string }[]>> = {
  Deployment: [
    { field: SourceField.Selector,       srcKind: 'Service',                  srcName: 'my-svc'     },
    { field: SourceField.ScaleTargetRef, srcKind: 'HorizontalPodAutoscaler',  srcName: 'my-app-hpa' },
  ],
  StatefulSet: [
    { field: SourceField.Selector,       srcKind: 'Service',                  srcName: 'my-svc'     },
    { field: SourceField.ScaleTargetRef, srcKind: 'HorizontalPodAutoscaler',  srcName: 'my-app-hpa' },
  ],
  DaemonSet: [
    { field: SourceField.Selector, srcKind: 'Service', srcName: 'my-svc' },
  ],
  Service: [
    { field: SourceField.IngressBackend, srcKind: 'Ingress',   srcName: 'my-ingress' },
    { field: SourceField.BackendRefs,    srcKind: 'HTTPRoute',  srcName: 'my-route'   },
  ],
  Gateway: [
    { field: SourceField.ParentRefs, srcKind: 'HTTPRoute', srcName: 'my-route' },
    { field: SourceField.ParentRefs, srcKind: 'TCPRoute',  srcName: 'my-tcp'   },
  ],
  Role: [
    { field: SourceField.RoleRef, srcKind: 'RoleBinding', srcName: 'my-binding' },
  ],
  ServiceAccount: [
    { field: SourceField.Subjects, srcKind: 'RoleBinding', srcName: 'my-binding' },
  ],
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface EdgeRow {
  field: SourceField;
  fieldLabel: string;
  yamlPath: string;
  targetKind: NodeKind;
  targetName: string;
}

export interface ResourceGroup {
  node: GraphNode;
  edges: EdgeRow[];
}

// ── Builder functions ────────────────────────────────────────────────────────

function toEdgeRow(field: SourceField, kind: NodeKind, name: string): EdgeRow {
  const g = FIELD_BASE[field];
  return { field, fieldLabel: g?.short ?? field, yamlPath: g?.yaml ?? '', targetKind: kind, targetName: name };
}

export function buildResourceGroups(
  kind: NodeKind,
  reverse: boolean,
  ns: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  pods: Record<string, GraphNode[]>,
): ResourceGroup[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const hasData = nodes.length > 0;

  if (hasData) {
    let srcNodes: GraphNode[];
    if (kind === 'Pod') {
      srcNodes = (Object.values(pods) as GraphNode[][]).flat();
      if (ns) srcNodes = srcNodes.filter(n => n.namespace === ns);
    } else {
      srcNodes = nodes.filter(n => n.kind === kind && (!ns || n.namespace === ns));
    }

    if (!srcNodes.length) return [];

    return srcNodes.map(srcNode => {
      const rawEdges = reverse
        ? edges.filter(e => e.target === srcNode.id && e.sourceField && nodeMap.has(e.source))
        : edges.filter(e => e.source === srcNode.id && e.sourceField && nodeMap.has(e.target));

      const edgeRows: EdgeRow[] = rawEdges.map(e => {
        const other = nodeMap.get(reverse ? e.source : e.target)!;
        return toEdgeRow(e.sourceField!, other.kind, other.name);
      });

      if (kind === 'Pod' && !reverse) {
        const ownerKind = srcNode.metadata['ownerKind'] as NodeKind | undefined;
        const ownerName = srcNode.metadata['ownerName'] as string | undefined;
        if (ownerKind && ownerName) {
          edgeRows.push(toEdgeRow(SourceField.OwnerReference, ownerKind, ownerName));
        }
      }

      return { node: srcNode, edges: edgeRows };
    }).filter(g => g.edges.length > 0);
  }

  // No live data — static examples
  const group = reverse ? buildStaticReverse(kind) : buildStaticOutgoing(kind);
  return group ? [group] : [];
}

function buildStaticOutgoing(kind: NodeKind): ResourceGroup | null {
  const defs = STATIC_OUTGOING[kind];
  if (!defs) return null;
  const srcName = kind === 'RoleBinding' ? 'my-binding'
                : kind === 'HTTPRoute' || kind === 'TCPRoute' ? 'my-route'
                : 'my-app';
  return {
    node: { id: `static/${kind}/${srcName}`, name: srcName, kind, category: 'workload', namespace: 'default', metadata: {} },
    edges: defs.map(d => toEdgeRow(d.field, d.tgtKind, d.tgtName)),
  };
}

function buildStaticReverse(kind: NodeKind): ResourceGroup | null {
  const defs = STATIC_INCOMING[kind];
  if (!defs) return buildStaticOutgoing(kind);
  return {
    node: { id: `static/${kind}/my-app`, name: 'my-app', kind, category: 'workload', namespace: 'default', metadata: {} },
    edges: defs.map(d => toEdgeRow(d.field, d.srcKind, d.srcName)),
  };
}
