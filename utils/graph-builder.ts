/**
 * Graph builder — constructs the K8s resource topology graph.
 * Pure logic: no Express, no kubectl. Accepts a getItemsFn abstraction.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { FILE_ALIASES, type K8sItem } from './snapshot-loader';

import {
  type NodeKind, type NodeCategory, PodPhase,
  EdgeType, SourceField,
  type GraphNode, type GraphEdge, type PodNode, type GraphResult,
} from '../shared/graph-types';

export {
  type NodeKind, type NodeCategory, PodPhase,
  EdgeType, SourceField,
  type GraphNode, type GraphEdge, type PodNode, type GraphResult,
} from '../shared/graph-types';

/** Abstraction for fetching K8s items — allows swapping between realtime (kubectl) and snapshot (YAML). */
export type GetItemsFn = (ns: string, resourceKey: string) => K8sItem[];
type AddNodeFn = (ns: string, kind: NodeKind, name: string, category: NodeCategory, metadata?: Record<string, unknown>) => string;
type AddEdgeFn = (source: string, target: string, type: EdgeType, sourceField?: SourceField) => void;

// --- Snapshot helpers ---

/**
 * Scan a directory to discover K8s namespaces.
 * @param dataPath - Directory path to scan (e.g. `'./k8s-snapshot'`)
 * @returns Map of `namespace → absolute directory path`
 * @example
 * discoverNamespaces('./k8s-snapshot')
 * // → Map { 'demo' => '/app/k8s-snapshot/demo', 'kube-system' => '/app/k8s-snapshot/kube-system' }
 */
export function discoverNamespaces(dataPath: string): Map<string, string> {
  const namespaces = new Map<string, string>();
  if (!fs.existsSync(dataPath)) return namespaces;
  const entries = fs.readdirSync(dataPath, { withFileTypes: true });
  const hasYaml = entries.some(e => e.isFile() && e.name.endsWith('.yaml'));
  if (hasYaml && !entries.some(e => e.isDirectory() && !e.name.startsWith('.'))) {
    const nsName = path.basename(dataPath);
    namespaces.set(nsName, dataPath);
  } else {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === '_cluster') continue;
      namespaces.set(entry.name, path.join(dataPath, entry.name));
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

/**
 * Load K8s items from a snapshot namespace directory.
 * Checks FILE_ALIASES first, then falls back to `${resourceKey}.yaml`.
 * @param nsDir - Absolute path to namespace directory (e.g. `'/app/k8s-snapshot/demo'`)
 * @param resourceKey - Resource type key (e.g. `'deployments'`, `'httproutes'`)
 * @returns Array of K8sItems; empty array if file not found
 */
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

// --- Helpers ---

/** Strip registry prefix, keep just `name:tag`. */
function shortenImage(img: string): string {
  const i = img.lastIndexOf('/');
  return i >= 0 ? img.substring(i + 1) : img;
}

/** Find the longest common prefix up to the last `/`. */
function commonRegistry(images: string[]): string {
  if (images.length < 2) return '';
  const parts = images.map(img => {
    const i = img.lastIndexOf('/');
    return i >= 0 ? img.substring(0, i + 1) : '';
  });
  const first = parts[0];
  if (!first || !parts.every(p => p === first)) return '';
  return first;
}

/** Extract all container images from a pod spec. */
function getContainerImages(podSpec: Record<string, unknown> | undefined): { full: string[]; short: string[]; registry: string } {
  if (!podSpec) return { full: [], short: [], registry: '' };
  const containers = (podSpec.containers || []) as Array<Record<string, unknown>>;
  const full = containers.map(c => c.image as string).filter(Boolean);
  return { full, short: full.map(shortenImage), registry: commonRegistry(full) };
}

// --- Graph building ---

/**
 * "Workload" = K8s resources that manage Pods: Deployment, StatefulSet, DaemonSet, CronJob.
 * They define a Pod template (`spec.template.spec`) which this function inspects.
 *
 * Extract edges from a workload's podSpec — discovers references to ConfigMaps,
 * Secrets, PVCs, and ServiceAccounts from envFrom, env.valueFrom, and volumes.
 *
 * Calls `addNode` / `addEdge` for each discovered reference. Does nothing if podSpec is undefined.
 *
 * @param ns - Namespace
 * @param kind - Workload kind (e.g. `'Deployment'`, `'StatefulSet'`)
 * @param name - Workload name
 * @param podSpec - The `spec.template.spec` object from the workload
 * @param addNode - Callback to register a new node; returns node ID
 * @param addEdge - Callback to register a new edge
 *
 * Edge types produced: `'uses-configmap'`, `'uses-secret'`, `'uses-pvc'`, `'uses-serviceaccount'`
 */
export function extractWorkloadEdges(
  ns: string,
  kind: NodeKind,
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
    addEdge(sourceId, `${ns}/ServiceAccount/${sa}`, EdgeType.UsesServiceAccount, SourceField.ServiceAccountName);
  }

  const containers = (podSpec.containers || []) as Array<Record<string, unknown>>;
  const initContainers = (podSpec.initContainers || []) as Array<Record<string, unknown>>;
  const allContainers = [...containers, ...initContainers];
  for (const container of allContainers) {
    for (const ef of (container.envFrom || []) as Array<Record<string, unknown>>) {
      const cmRef = ef.configMapRef as { name?: string } | undefined;
      if (cmRef?.name) {
        addNode(ns, 'ConfigMap', cmRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${cmRef.name}`, EdgeType.UsesConfigMap, SourceField.EnvFromConfigMap);
      }
      const secRef = ef.secretRef as { name?: string } | undefined;
      if (secRef?.name) {
        addNode(ns, 'Secret', secRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${secRef.name}`, EdgeType.UsesSecret, SourceField.EnvFromSecret);
      }
    }
    for (const env of (container.env || []) as Array<Record<string, unknown>>) {
      const valueFrom = env.valueFrom as Record<string, unknown> | undefined;
      const cmKeyRef = valueFrom?.configMapKeyRef as { name?: string } | undefined;
      if (cmKeyRef?.name) {
        addNode(ns, 'ConfigMap', cmKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${cmKeyRef.name}`, EdgeType.UsesConfigMap, SourceField.EnvConfigMapKey);
      }
      const secKeyRef = valueFrom?.secretKeyRef as { name?: string } | undefined;
      if (secKeyRef?.name) {
        addNode(ns, 'Secret', secKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${secKeyRef.name}`, EdgeType.UsesSecret, SourceField.EnvSecretKey);
      }
    }
  }

  for (const vol of (podSpec.volumes || []) as Array<Record<string, unknown>>) {
    const pvc = vol.persistentVolumeClaim as { claimName?: string } | undefined;
    if (pvc?.claimName) {
      addNode(ns, 'PersistentVolumeClaim', pvc.claimName, 'storage');
      addEdge(sourceId, `${ns}/PersistentVolumeClaim/${pvc.claimName}`, EdgeType.UsesPVC, SourceField.VolumePVC);
    }
    const cm = vol.configMap as { name?: string } | undefined;
    if (cm?.name) {
      addNode(ns, 'ConfigMap', cm.name, 'abstract');
      addEdge(sourceId, `${ns}/ConfigMap/${cm.name}`, EdgeType.UsesConfigMap, SourceField.VolumeConfigMap);
    }
    const sec = vol.secret as { secretName?: string } | undefined;
    if (sec?.secretName) {
      addNode(ns, 'Secret', sec.secretName, 'abstract');
      addEdge(sourceId, `${ns}/Secret/${sec.secretName}`, EdgeType.UsesSecret, SourceField.VolumeSecret);
    }
    const projected = vol.projected as { sources?: Array<Record<string, unknown>> } | undefined;
    if (projected?.sources) {
      for (const src of projected.sources) {
        const projCm = src.configMap as { name?: string } | undefined;
        if (projCm?.name) {
          addNode(ns, 'ConfigMap', projCm.name, 'abstract');
          addEdge(sourceId, `${ns}/ConfigMap/${projCm.name}`, EdgeType.UsesConfigMap, SourceField.ProjectedConfigMap);
        }
        const projSec = src.secret as { name?: string } | undefined;
        if (projSec?.name) {
          addNode(ns, 'Secret', projSec.name, 'abstract');
          addEdge(sourceId, `${ns}/Secret/${projSec.name}`, EdgeType.UsesSecret, SourceField.ProjectedSecret);
        }
      }
    }
  }
}

/**
 * Build the complete K8s resource topology graph.
 *
 * Iterates over all namespaces and resource types (Deployments, StatefulSets,
 * DaemonSets, CronJobs, Services, HTTPRoutes, TCPRoutes, Gateways, Ingresses,
 * HPAs, RoleBindings, ConfigMaps), creating nodes and edges.
 *
 * Also parses Pods and groups them by parent workload (via ownerReferences).
 *
 * @param getItemsFn - Abstraction to fetch items; accepts `(namespace, resourceKey)`.
 *   In realtime mode this runs kubectl; in snapshot mode it reads YAML files.
 * @param namespaceList - Namespaces to process
 * @returns `{ nodes, edges, pods, namespaces, stats }`
 *
 * @example
 * const result = buildGraph(getItemsFromSnapshot.bind(null, nsDir), ['demo']);
 * // result.nodes = [{ id: 'demo/Deployment/web', kind: 'Deployment', ... }, ...]
 * // result.edges = [{ source: 'demo/Service/web-svc', target: 'demo/Deployment/web', type: 'exposes' }, ...]
 * // result.stats = { totalNodes: 71, totalEdges: 78, byKind: { Deployment: 17, ... }, namespaceCount: 1 }
 */
export function buildGraph(getItemsFn: GetItemsFn, namespaceList: string[]): GraphResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const allNamespaces: string[] = [];

  function addNode(ns: string, kind: NodeKind, name: string, category: NodeCategory, metadata: Record<string, unknown> = {}): string {
    const id = `${ns}/${kind}/${name}`;
    if (nodeIds.has(id)) return id;
    nodeIds.add(id);
    nodes.push({ id, name, kind, category, namespace: ns, metadata });
    return id;
  }

  function addEdge(source: string, target: string, type: EdgeType, sourceField?: SourceField): void {
    const key = `${source}|${target}|${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, type, ...(sourceField && { sourceField }) });
  }

  for (const ns of namespaceList) {
    allNamespaces.push(ns);

    const deployments = getItemsFn(ns, 'deployments');
    for (const d of deployments) {
      const name = d.metadata?.name;
      if (!name) continue;
      const deployPodSpec = ((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
      const deployImages = getContainerImages(deployPodSpec);
      addNode(ns, 'Deployment', name, 'workload', {
        replicas: (d.spec as Record<string, unknown>)?.replicas,
        image: deployImages.full[0],
        containers: deployImages.short,
        registry: deployImages.registry,
      });
      extractWorkloadEdges(ns, 'Deployment', name, ((d.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined, addNode, addEdge);
    }

    const statefulsets = getItemsFn(ns, 'statefulsets');
    for (const s of statefulsets) {
      const name = s.metadata?.name;
      if (!name) continue;
      const ssPodSpec = ((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
      const ssImages = getContainerImages(ssPodSpec);
      addNode(ns, 'StatefulSet', name, 'workload', {
        replicas: (s.spec as Record<string, unknown>)?.replicas,
        image: ssImages.full[0],
        containers: ssImages.short,
        registry: ssImages.registry,
      });
      extractWorkloadEdges(ns, 'StatefulSet', name, ((s.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined, addNode, addEdge);
    }

    const daemonsets = getItemsFn(ns, 'daemonsets');
    for (const ds of daemonsets) {
      const name = ds.metadata?.name;
      if (!name) continue;
      const dsPodSpec = ((ds.spec as Record<string, unknown>)?.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
      const dsImages = getContainerImages(dsPodSpec);
      addNode(ns, 'DaemonSet', name, 'workload', {
        image: dsImages.full[0],
        containers: dsImages.short,
        registry: dsImages.registry,
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
          addEdge(`${ns}/Service/${svcName}`, `${ns}/${w.kind}/${w.item.metadata.name}`, EdgeType.Exposes, SourceField.Selector);
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
          addEdge(`${ns}/HTTPRoute/${hrName}`, `${gwNs}/Gateway/${pr.name}`, EdgeType.ParentGateway, SourceField.ParentRefs);
        }
      }

      for (const rule of (hrSpec?.rules || []) as Array<Record<string, unknown>>) {
        for (const br of (rule.backendRefs || []) as Array<Record<string, unknown>>) {
          if (br.name) {
            const backendNs = (br.namespace as string) || ns;
            const svcId = `${backendNs}/Service/${br.name}`;
            if (nodeIds.has(svcId)) {
              addEdge(`${ns}/HTTPRoute/${hrName}`, svcId, EdgeType.RoutesTo, SourceField.BackendRefs);
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
          addEdge(`${ns}/TCPRoute/${trName}`, `${gwNs}/Gateway/${pr.name}`, EdgeType.ParentGateway, SourceField.ParentRefs);
        }
      }

      for (const rule of (trSpec?.rules || []) as Array<Record<string, unknown>>) {
        for (const br of (rule.backendRefs || []) as Array<Record<string, unknown>>) {
          if (br.name) {
            const backendNs = (br.namespace as string) || ns;
            const svcId = `${backendNs}/Service/${br.name}`;
            if (nodeIds.has(svcId)) {
              addEdge(`${ns}/TCPRoute/${trName}`, svcId, EdgeType.RoutesTo, SourceField.BackendRefs);
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
            addEdge(`${ns}/Ingress/${ingName}`, `${ns}/Service/${backendName}`, EdgeType.RoutesTo, SourceField.IngressBackend);
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
          addEdge(`${ns}/HorizontalPodAutoscaler/${hpaName}`, targetId, EdgeType.Exposes, SourceField.ScaleTargetRef);
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
        addEdge(`${ns}/RoleBinding/${rbName}`, `${ns}/Role/${rb.roleRef.name}`, EdgeType.BindsRole, SourceField.RoleRef);
      }

      for (const subj of rb.subjects || []) {
        if (subj.kind === 'ServiceAccount' && subj.name) {
          const saId = `${ns}/ServiceAccount/${subj.name}`;
          if (nodeIds.has(saId)) {
            addEdge(`${ns}/RoleBinding/${rbName}`, saId, EdgeType.BindsRole, SourceField.Subjects);
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
      const phase = (podStatus?.phase as string) || PodPhase.Unknown;
      const containerStatuses = (podStatus?.containerStatuses || []) as Array<Record<string, unknown>>;
      let displayStatus = phase as PodPhase;
      for (const cs of containerStatuses) {
        const state = cs.state as Record<string, unknown> | undefined;
        const waiting = state?.waiting as Record<string, unknown> | undefined;
        if (waiting?.reason === PodPhase.CrashLoopBackOff) {
          displayStatus = PodPhase.CrashLoopBackOff;
          break;
        }
      }

      const podSpec = pod.spec as Record<string, unknown> | undefined;
      const podImages = getContainerImages(podSpec);
      const image = podImages.full[0];
      const nodeName = podSpec?.nodeName as string | undefined;
      const restarts = containerStatuses.reduce((sum, cs) => sum + ((cs.restartCount as number) || 0), 0);

      let ownerKind: NodeKind | null = null;
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
          containers: podImages.short,
          registry: podImages.registry,
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
