/**
 * Graph builder — constructs the K8s resource topology graph.
 * Pure logic: no Express, no kubectl. Accepts a getItemsFn abstraction.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { FILE_ALIASES, type K8sItem } from './snapshot-loader';

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  category: string;
  namespace: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  sourceField?: string;
}

export interface PodNode extends GraphNode {
  metadata: {
    status: string;
    ownerKind: string;
    ownerName: string;
    image?: string;
    node?: string;
    restarts: number;
    [key: string]: unknown;
  };
}

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

export type GetItemsFn = (ns: string, resourceKey: string) => K8sItem[];
type AddNodeFn = (ns: string, kind: string, name: string, category: string, metadata?: Record<string, unknown>) => string;
type AddEdgeFn = (source: string, target: string, type: string, sourceField?: string) => void;

// --- Snapshot helpers ---

export function discoverNamespaces(dataPaths: string[]): Map<string, string> {
  const namespaces = new Map<string, string>();
  for (const dp of dataPaths) {
    if (!fs.existsSync(dp)) continue;
    const entries = fs.readdirSync(dp, { withFileTypes: true });
    const hasYaml = entries.some(e => e.isFile() && e.name.endsWith('.yaml'));
    if (hasYaml && !entries.some(e => e.isDirectory() && !e.name.startsWith('.'))) {
      const nsName = path.basename(dp);
      namespaces.set(nsName, dp);
    } else {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === '_cluster') continue;
        namespaces.set(entry.name, path.join(dp, entry.name));
      }
    }
  }
  return namespaces;
}

function loadYamlFile(nsDir: string, filename: string): Record<string, unknown> | null {
  const filePath = path.join(nsDir, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to parse ${filePath}: ${msg}`);
    return null;
  }
}

export function getItemsFromSnapshot(nsDir: string, resourceKey: string): K8sItem[] {
  const aliases = FILE_ALIASES[resourceKey];
  if (aliases) {
    for (const fname of aliases) {
      const data = loadYamlFile(nsDir, fname) as { items?: K8sItem[] } | null;
      if (data?.items) return data.items;
    }
    return [];
  }
  const data = loadYamlFile(nsDir, `${resourceKey}.yaml`) as { items?: K8sItem[] } | null;
  return data?.items || [];
}

// --- Graph building ---

export function extractWorkloadEdges(
  ns: string,
  kind: string,
  name: string,
  podSpec: Record<string, unknown> | undefined,
  addNode: AddNodeFn,
  addEdge: AddEdgeFn,
): void {
  if (!podSpec) return;
  const sourceId = `${ns}/${kind}/${name}`;

  const sa = podSpec.serviceAccountName as string | undefined;
  if (sa && sa !== 'default') {
    addNode(ns, 'ServiceAccount', sa, 'rbac');
    addEdge(sourceId, `${ns}/ServiceAccount/${sa}`, 'uses-serviceaccount', 'spec.serviceAccountName');
  }

  const containers = (podSpec.containers || []) as Array<Record<string, unknown>>;
  const initContainers = (podSpec.initContainers || []) as Array<Record<string, unknown>>;
  const allContainers = [...containers, ...initContainers];
  for (const container of allContainers) {
    for (const ef of (container.envFrom || []) as Array<Record<string, unknown>>) {
      const cmRef = ef.configMapRef as { name?: string } | undefined;
      if (cmRef?.name) {
        addNode(ns, 'ConfigMap', cmRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${cmRef.name}`, 'uses-configmap', 'envFrom.configMapRef');
      }
      const secRef = ef.secretRef as { name?: string } | undefined;
      if (secRef?.name) {
        addNode(ns, 'Secret', secRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${secRef.name}`, 'uses-secret', 'envFrom.secretRef');
      }
    }
    for (const env of (container.env || []) as Array<Record<string, unknown>>) {
      const valueFrom = env.valueFrom as Record<string, unknown> | undefined;
      const cmKeyRef = valueFrom?.configMapKeyRef as { name?: string } | undefined;
      if (cmKeyRef?.name) {
        addNode(ns, 'ConfigMap', cmKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${cmKeyRef.name}`, 'uses-configmap', 'env.valueFrom.configMapKeyRef');
      }
      const secKeyRef = valueFrom?.secretKeyRef as { name?: string } | undefined;
      if (secKeyRef?.name) {
        addNode(ns, 'Secret', secKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${secKeyRef.name}`, 'uses-secret', 'env.valueFrom.secretKeyRef');
      }
    }
  }

  for (const vol of (podSpec.volumes || []) as Array<Record<string, unknown>>) {
    const pvc = vol.persistentVolumeClaim as { claimName?: string } | undefined;
    if (pvc?.claimName) {
      addNode(ns, 'PersistentVolumeClaim', pvc.claimName, 'storage');
      addEdge(sourceId, `${ns}/PersistentVolumeClaim/${pvc.claimName}`, 'uses-pvc', 'volumes.persistentVolumeClaim');
    }
    const cm = vol.configMap as { name?: string } | undefined;
    if (cm?.name) {
      addNode(ns, 'ConfigMap', cm.name, 'abstract');
      addEdge(sourceId, `${ns}/ConfigMap/${cm.name}`, 'uses-configmap', 'volumes.configMap');
    }
    const sec = vol.secret as { secretName?: string } | undefined;
    if (sec?.secretName) {
      addNode(ns, 'Secret', sec.secretName, 'abstract');
      addEdge(sourceId, `${ns}/Secret/${sec.secretName}`, 'uses-secret', 'volumes.secret');
    }
    const projected = vol.projected as { sources?: Array<Record<string, unknown>> } | undefined;
    if (projected?.sources) {
      for (const src of projected.sources) {
        const projCm = src.configMap as { name?: string } | undefined;
        if (projCm?.name) {
          addNode(ns, 'ConfigMap', projCm.name, 'abstract');
          addEdge(sourceId, `${ns}/ConfigMap/${projCm.name}`, 'uses-configmap', 'volumes.projected.configMap');
        }
        const projSec = src.secret as { name?: string } | undefined;
        if (projSec?.name) {
          addNode(ns, 'Secret', projSec.name, 'abstract');
          addEdge(sourceId, `${ns}/Secret/${projSec.name}`, 'uses-secret', 'volumes.projected.secret');
        }
      }
    }
  }
}

export function buildGraph(getItemsFn: GetItemsFn, namespaceList: string[]): GraphResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const allNamespaces: string[] = [];

  function addNode(ns: string, kind: string, name: string, category: string, metadata: Record<string, unknown> = {}): string {
    const id = `${ns}/${kind}/${name}`;
    if (nodeIds.has(id)) return id;
    nodeIds.add(id);
    nodes.push({ id, name, kind, category, namespace: ns, metadata });
    return id;
  }

  function addEdge(source: string, target: string, type: string, sourceField?: string): void {
    edges.push({ source, target, type, ...(sourceField && { sourceField }) });
  }

  for (const ns of namespaceList) {
    allNamespaces.push(ns);

    const deployments = getItemsFn(ns, 'deployments');
    for (const d of deployments) {
      const name = d.metadata?.name;
      if (!name) continue;
      addNode(ns, 'Deployment', name, 'workload', {
        replicas: (d.spec as Record<string, unknown>)?.replicas,
        image: ((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)
          ? (((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)
            ? ((((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)?.containers as Array<Record<string, unknown>>)?.[0]?.image
            : undefined
          : undefined,
      });
      extractWorkloadEdges(ns, 'Deployment', name, ((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined, addNode, addEdge);
    }

    const statefulsets = getItemsFn(ns, 'statefulsets');
    for (const s of statefulsets) {
      const name = s.metadata?.name;
      if (!name) continue;
      addNode(ns, 'StatefulSet', name, 'workload', {
        replicas: (s.spec as Record<string, unknown>)?.replicas,
        image: ((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)
          ? (((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)
            ? ((((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)?.containers as Array<Record<string, unknown>>)?.[0]?.image
            : undefined
          : undefined,
      });
      extractWorkloadEdges(ns, 'StatefulSet', name, ((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined, addNode, addEdge);
    }

    const daemonsets = getItemsFn(ns, 'daemonsets');
    for (const ds of daemonsets) {
      const name = ds.metadata?.name;
      if (!name) continue;
      addNode(ns, 'DaemonSet', name, 'workload', {
        image: ((ds.spec as Record<string, unknown>)?.template as Record<string, unknown>)
          ? (((ds.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)
            ? ((((ds.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown>)?.containers as Array<Record<string, unknown>>)?.[0]?.image
            : undefined
          : undefined,
      });
      extractWorkloadEdges(ns, 'DaemonSet', name, ((ds.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined, addNode, addEdge);
    }

    const cronjobs = getItemsFn(ns, 'cronjobs');
    for (const c of cronjobs) {
      const name = c.metadata?.name;
      if (!name) continue;
      addNode(ns, 'CronJob', name, 'workload', { schedule: (c.spec as Record<string, unknown>)?.schedule });
      const jobTemplate = (c.spec as Record<string, unknown>)?.jobTemplate as Record<string, unknown> | undefined;
      const jobSpec = jobTemplate?.spec as Record<string, unknown> | undefined;
      const templateSpec = (jobSpec?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
      extractWorkloadEdges(ns, 'CronJob', name, templateSpec, addNode, addEdge);
    }

    const allWorkloads = [
      ...deployments.map(d => ({ kind: 'Deployment', item: d })),
      ...statefulsets.map(s => ({ kind: 'StatefulSet', item: s })),
      ...daemonsets.map(ds => ({ kind: 'DaemonSet', item: ds })),
    ];

    const services = getItemsFn(ns, 'services');
    for (const svc of services) {
      const svcName = svc.metadata?.name;
      if (!svcName) continue;
      const svcSpec = svc.spec as Record<string, unknown> | undefined;
      const selector = svcSpec?.selector as Record<string, string> | undefined;
      if (!selector) continue;
      const ports = svcSpec?.ports as Array<{ port: number; protocol?: string }> | undefined;
      addNode(ns, 'Service', svcName, 'abstract', {
        type: svcSpec?.type,
        ports: ports?.map(p => `${p.port}/${p.protocol || 'TCP'}`),
      });

      for (const w of allWorkloads) {
        const wSpec = w.item.spec as Record<string, unknown> | undefined;
        const template = wSpec?.template as Record<string, unknown> | undefined;
        const templateMeta = template?.metadata as Record<string, unknown> | undefined;
        const podLabels = (templateMeta?.labels || {}) as Record<string, string>;
        const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
        if (matches) {
          addEdge(`${ns}/Service/${svcName}`, `${ns}/${w.kind}/${w.item.metadata.name}`, 'exposes', 'spec.selector');
        }
      }
    }

    const httproutes = getItemsFn(ns, 'httproutes');
    for (const hr of httproutes) {
      const hrName = hr.metadata?.name;
      if (!hrName) continue;
      const hrSpec = hr.spec as Record<string, unknown> | undefined;
      addNode(ns, 'HTTPRoute', hrName, 'abstract', { hostnames: hrSpec?.hostnames });

      for (const pr of (hrSpec?.parentRefs || []) as Array<Record<string, unknown>>) {
        if (pr.name) {
          const gwNs = (pr.namespace as string) || ns;
          addNode(gwNs, 'Gateway', pr.name as string, 'abstract');
          addEdge(`${ns}/HTTPRoute/${hrName}`, `${gwNs}/Gateway/${pr.name}`, 'parent-gateway', 'spec.parentRefs');
        }
      }

      for (const rule of (hrSpec?.rules || []) as Array<Record<string, unknown>>) {
        for (const br of (rule.backendRefs || []) as Array<Record<string, unknown>>) {
          if (br.name) {
            const backendNs = (br.namespace as string) || ns;
            const svcId = `${backendNs}/Service/${br.name}`;
            if (nodeIds.has(svcId)) {
              addEdge(`${ns}/HTTPRoute/${hrName}`, svcId, 'routes-to', 'spec.rules.backendRefs');
            }
          }
        }
      }
    }

    const tcproutes = getItemsFn(ns, 'tcproutes');
    for (const tr of tcproutes) {
      const trName = tr.metadata?.name;
      if (!trName) continue;
      const trSpec = tr.spec as Record<string, unknown> | undefined;
      addNode(ns, 'TCPRoute', trName, 'abstract', {});

      for (const pr of (trSpec?.parentRefs || []) as Array<Record<string, unknown>>) {
        if (pr.name) {
          const gwNs = (pr.namespace as string) || ns;
          addNode(gwNs, 'Gateway', pr.name as string, 'abstract');
          addEdge(`${ns}/TCPRoute/${trName}`, `${gwNs}/Gateway/${pr.name}`, 'parent-gateway', 'spec.parentRefs');
        }
      }

      for (const rule of (trSpec?.rules || []) as Array<Record<string, unknown>>) {
        for (const br of (rule.backendRefs || []) as Array<Record<string, unknown>>) {
          if (br.name) {
            const backendNs = (br.namespace as string) || ns;
            const svcId = `${backendNs}/Service/${br.name}`;
            if (nodeIds.has(svcId)) {
              addEdge(`${ns}/TCPRoute/${trName}`, svcId, 'routes-to', 'spec.rules.backendRefs');
            }
          }
        }
      }
    }

    const gateways = getItemsFn(ns, 'gateways');
    for (const gw of gateways) {
      const gwName = gw.metadata?.name;
      if (gwName) addNode(ns, 'Gateway', gwName, 'abstract', { gatewayClassName: (gw.spec as Record<string, unknown>)?.gatewayClassName });
    }

    const ingresses = getItemsFn(ns, 'ingresses');
    for (const ing of ingresses) {
      const ingName = ing.metadata?.name;
      if (!ingName) continue;
      const ingSpec = ing.spec as Record<string, unknown> | undefined;
      const rules = (ingSpec?.rules || []) as Array<Record<string, unknown>>;
      addNode(ns, 'Ingress', ingName, 'abstract', {
        hosts: rules.map(r => r.host).filter(Boolean),
      });
      for (const rule of rules) {
        const httpPaths = (rule.http as Record<string, unknown>)?.paths as Array<Record<string, unknown>> | undefined;
        for (const p of httpPaths || []) {
          const backend = p.backend as Record<string, unknown> | undefined;
          const backendName = (backend?.service as Record<string, unknown>)?.name as string | undefined
            || backend?.serviceName as string | undefined;
          if (backendName && nodeIds.has(`${ns}/Service/${backendName}`)) {
            addEdge(`${ns}/Ingress/${ingName}`, `${ns}/Service/${backendName}`, 'routes-to', 'spec.rules.http.paths.backend');
          }
        }
      }
    }

    const hpas = getItemsFn(ns, 'horizontalpodautoscalers');
    for (const hpa of hpas) {
      const hpaName = hpa.metadata?.name;
      if (!hpaName) continue;
      const hpaSpec = hpa.spec as Record<string, unknown> | undefined;
      addNode(ns, 'HorizontalPodAutoscaler', hpaName, 'abstract', {
        minReplicas: hpaSpec?.minReplicas,
        maxReplicas: hpaSpec?.maxReplicas,
      });
      const scaleTargetRef = hpaSpec?.scaleTargetRef as Record<string, unknown> | undefined;
      const targetName = scaleTargetRef?.name as string | undefined;
      const targetKind = scaleTargetRef?.kind as string | undefined;
      if (targetName && targetKind) {
        const targetId = `${ns}/${targetKind}/${targetName}`;
        if (nodeIds.has(targetId)) {
          addEdge(`${ns}/HorizontalPodAutoscaler/${hpaName}`, targetId, 'exposes', 'spec.scaleTargetRef');
        }
      }
    }

    const rolebindings = getItemsFn(ns, 'rolebindings');
    for (const rb of rolebindings) {
      const rbName = rb.metadata?.name;
      if (!rbName) continue;
      addNode(ns, 'RoleBinding', rbName, 'rbac');

      if (rb.roleRef?.name) {
        addNode(ns, 'Role', rb.roleRef.name, 'rbac');
        addEdge(`${ns}/RoleBinding/${rbName}`, `${ns}/Role/${rb.roleRef.name}`, 'binds-role', 'roleRef');
      }

      for (const subj of rb.subjects || []) {
        if (subj.kind === 'ServiceAccount' && subj.name) {
          const saId = `${ns}/ServiceAccount/${subj.name}`;
          if (nodeIds.has(saId)) {
            addEdge(`${ns}/RoleBinding/${rbName}`, saId, 'binds-role', 'subjects');
          }
        }
      }
    }

    const allConfigMaps = getItemsFn(ns, 'configmaps');
    for (const cm of allConfigMaps) {
      const cmName = cm.metadata?.name;
      if (!cmName) continue;
      const cmId = `${ns}/ConfigMap/${cmName}`;
      if (!nodeIds.has(cmId)) {
        addNode(ns, 'ConfigMap', cmName, 'abstract', { orphan: true });
      }
    }
  }

  // Parse Pods
  const pods: Record<string, PodNode[]> = {};
  for (const ns of namespaceList) {
    const podItems = getItemsFn(ns, 'pods');
    for (const pod of podItems) {
      const podName = pod.metadata?.name;
      if (!podName) continue;

      const podStatus = pod.status as Record<string, unknown> | undefined;
      const phase = (podStatus?.phase as string) || 'Unknown';
      const containerStatuses = (podStatus?.containerStatuses || []) as Array<Record<string, unknown>>;
      let displayStatus = phase;
      for (const cs of containerStatuses) {
        const state = cs.state as Record<string, unknown> | undefined;
        const waiting = state?.waiting as Record<string, unknown> | undefined;
        if (waiting?.reason === 'CrashLoopBackOff') {
          displayStatus = 'CrashLoopBackOff';
          break;
        }
      }

      const podSpec = pod.spec as Record<string, unknown> | undefined;
      const image = ((podSpec?.containers as Array<Record<string, unknown>>)?.[0])?.image as string | undefined;
      const nodeName = podSpec?.nodeName as string | undefined;
      const restarts = containerStatuses.reduce((sum, cs) => sum + ((cs.restartCount as number) || 0), 0);

      let ownerKind: string | null = null;
      let ownerName: string | null = null;
      const ownerRefs = pod.metadata?.ownerReferences || [];
      for (const ref of ownerRefs) {
        if (ref.kind === 'ReplicaSet') {
          const rsName = ref.name;
          const lastDash = rsName.lastIndexOf('-');
          ownerName = lastDash > 0 ? rsName.substring(0, lastDash) : rsName;
          ownerKind = 'Deployment';
        } else if (ref.kind === 'StatefulSet') {
          ownerKind = 'StatefulSet';
          ownerName = ref.name;
        } else if (ref.kind === 'Job') {
          const jobName = ref.name;
          const lastDash = jobName.lastIndexOf('-');
          const possibleCronJob = lastDash > 0 ? jobName.substring(0, lastDash) : jobName;
          if (nodeIds.has(`${ns}/CronJob/${possibleCronJob}`)) {
            ownerKind = 'CronJob';
            ownerName = possibleCronJob;
          } else {
            ownerKind = 'Job';
            ownerName = ref.name;
          }
        }
      }

      if (!ownerKind || !ownerName) continue;

      const parentId = `${ns}/${ownerKind}/${ownerName}`;
      if (!nodeIds.has(parentId)) continue;

      const podNode: PodNode = {
        id: `${ns}/Pod/${podName}`,
        name: podName,
        kind: 'Pod',
        category: 'workload',
        namespace: ns,
        metadata: {
          status: displayStatus,
          ownerKind,
          ownerName,
          image,
          node: nodeName,
          restarts,
        },
      };

      if (!pods[parentId]) pods[parentId] = [];
      pods[parentId].push(podNode);
    }
  }

  const byKind: Record<string, number> = {};
  for (const n of nodes) {
    byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  }

  return {
    nodes,
    edges,
    pods,
    namespaces: allNamespaces.sort(),
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      byKind,
      namespaceCount: allNamespaces.length,
    },
  };
}
