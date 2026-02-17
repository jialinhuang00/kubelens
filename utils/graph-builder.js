/**
 * Graph builder — constructs the K8s resource topology graph.
 * Pure logic: no Express, no kubectl. Accepts a getItemsFn abstraction.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FILE_ALIASES = {
  'httproutes': ['httproutes.gateway.networking.k8s.io.yaml', 'httproutes.yaml'],
  'tcproutes': ['tcproutes.gateway.networking.k8s.io.yaml', 'tcproutes.yaml'],
  'gateways': ['gateways.gateway.networking.k8s.io.yaml', 'gateways.yaml'],
};

// --- Snapshot helpers ---

function discoverNamespaces(dataPaths) {
  const namespaces = new Map();
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

function loadYamlFile(nsDir, filename) {
  const filePath = path.join(nsDir, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`Failed to parse ${filePath}: ${e.message}`);
    return null;
  }
}

function getItemsFromSnapshot(nsDir, resourceKey) {
  const aliases = FILE_ALIASES[resourceKey];
  if (aliases) {
    for (const fname of aliases) {
      const data = loadYamlFile(nsDir, fname);
      if (data?.items) return data.items;
    }
    return [];
  }
  const data = loadYamlFile(nsDir, `${resourceKey}.yaml`);
  return data?.items || [];
}

// --- Graph building ---

function extractWorkloadEdges(ns, kind, name, podSpec, addNode, addEdge) {
  if (!podSpec) return;
  const sourceId = `${ns}/${kind}/${name}`;

  const sa = podSpec.serviceAccountName;
  if (sa && sa !== 'default') {
    addNode(ns, 'ServiceAccount', sa, 'rbac');
    addEdge(sourceId, `${ns}/ServiceAccount/${sa}`, 'uses-serviceaccount', 'spec.serviceAccountName');
  }

  const allContainers = [...(podSpec.containers || []), ...(podSpec.initContainers || [])];
  for (const container of allContainers) {
    for (const ef of container.envFrom || []) {
      if (ef.configMapRef?.name) {
        addNode(ns, 'ConfigMap', ef.configMapRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${ef.configMapRef.name}`, 'uses-configmap', 'envFrom.configMapRef');
      }
      if (ef.secretRef?.name) {
        addNode(ns, 'Secret', ef.secretRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${ef.secretRef.name}`, 'uses-secret', 'envFrom.secretRef');
      }
    }
    for (const env of container.env || []) {
      if (env.valueFrom?.configMapKeyRef?.name) {
        addNode(ns, 'ConfigMap', env.valueFrom.configMapKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/ConfigMap/${env.valueFrom.configMapKeyRef.name}`, 'uses-configmap', 'env.valueFrom.configMapKeyRef');
      }
      if (env.valueFrom?.secretKeyRef?.name) {
        addNode(ns, 'Secret', env.valueFrom.secretKeyRef.name, 'abstract');
        addEdge(sourceId, `${ns}/Secret/${env.valueFrom.secretKeyRef.name}`, 'uses-secret', 'env.valueFrom.secretKeyRef');
      }
    }
  }

  for (const vol of podSpec.volumes || []) {
    if (vol.persistentVolumeClaim?.claimName) {
      const pvcName = vol.persistentVolumeClaim.claimName;
      addNode(ns, 'PersistentVolumeClaim', pvcName, 'storage');
      addEdge(sourceId, `${ns}/PersistentVolumeClaim/${pvcName}`, 'uses-pvc', 'volumes.persistentVolumeClaim');
    }
    if (vol.configMap?.name) {
      addNode(ns, 'ConfigMap', vol.configMap.name, 'abstract');
      addEdge(sourceId, `${ns}/ConfigMap/${vol.configMap.name}`, 'uses-configmap', 'volumes.configMap');
    }
    if (vol.secret?.secretName) {
      addNode(ns, 'Secret', vol.secret.secretName, 'abstract');
      addEdge(sourceId, `${ns}/Secret/${vol.secret.secretName}`, 'uses-secret', 'volumes.secret');
    }
    if (vol.projected?.sources) {
      for (const src of vol.projected.sources) {
        if (src.configMap?.name) {
          addNode(ns, 'ConfigMap', src.configMap.name, 'abstract');
          addEdge(sourceId, `${ns}/ConfigMap/${src.configMap.name}`, 'uses-configmap', 'volumes.projected.configMap');
        }
        if (src.secret?.name) {
          addNode(ns, 'Secret', src.secret.name, 'abstract');
          addEdge(sourceId, `${ns}/Secret/${src.secret.name}`, 'uses-secret', 'volumes.projected.secret');
        }
      }
    }
  }
}

function buildGraph(getItemsFn, namespaceList) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const allNamespaces = [];

  function addNode(ns, kind, name, category, metadata = {}) {
    const id = `${ns}/${kind}/${name}`;
    if (nodeIds.has(id)) return id;
    nodeIds.add(id);
    nodes.push({ id, name, kind, category, namespace: ns, metadata });
    return id;
  }

  function addEdge(source, target, type, sourceField) {
    edges.push({ source, target, type, ...(sourceField && { sourceField }) });
  }

  for (const ns of namespaceList) {
    allNamespaces.push(ns);

    const deployments = getItemsFn(ns, 'deployments');
    for (const d of deployments) {
      const name = d.metadata?.name;
      if (!name) continue;
      addNode(ns, 'Deployment', name, 'workload', {
        replicas: d.spec?.replicas,
        image: d.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'Deployment', name, d.spec?.template?.spec, addNode, addEdge);
    }

    const statefulsets = getItemsFn(ns, 'statefulsets');
    for (const s of statefulsets) {
      const name = s.metadata?.name;
      if (!name) continue;
      addNode(ns, 'StatefulSet', name, 'workload', {
        replicas: s.spec?.replicas,
        image: s.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'StatefulSet', name, s.spec?.template?.spec, addNode, addEdge);
    }

    const daemonsets = getItemsFn(ns, 'daemonsets');
    for (const ds of daemonsets) {
      const name = ds.metadata?.name;
      if (!name) continue;
      addNode(ns, 'DaemonSet', name, 'workload', {
        image: ds.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'DaemonSet', name, ds.spec?.template?.spec, addNode, addEdge);
    }

    const cronjobs = getItemsFn(ns, 'cronjobs');
    for (const c of cronjobs) {
      const name = c.metadata?.name;
      if (!name) continue;
      addNode(ns, 'CronJob', name, 'workload', { schedule: c.spec?.schedule });
      extractWorkloadEdges(ns, 'CronJob', name, c.spec?.jobTemplate?.spec?.template?.spec, addNode, addEdge);
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
      const selector = svc.spec?.selector;
      if (!selector) continue;
      addNode(ns, 'Service', svcName, 'abstract', {
        type: svc.spec?.type,
        ports: svc.spec?.ports?.map(p => `${p.port}/${p.protocol || 'TCP'}`),
      });

      for (const w of allWorkloads) {
        const podLabels = w.item.spec?.template?.metadata?.labels || {};
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
      addNode(ns, 'HTTPRoute', hrName, 'abstract', { hostnames: hr.spec?.hostnames });

      for (const pr of hr.spec?.parentRefs || []) {
        if (pr.name) {
          const gwNs = pr.namespace || ns;
          addNode(gwNs, 'Gateway', pr.name, 'abstract');
          addEdge(`${ns}/HTTPRoute/${hrName}`, `${gwNs}/Gateway/${pr.name}`, 'parent-gateway', 'spec.parentRefs');
        }
      }

      for (const rule of hr.spec?.rules || []) {
        for (const br of rule.backendRefs || []) {
          if (br.name) {
            const backendNs = br.namespace || ns;
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
      addNode(ns, 'TCPRoute', trName, 'abstract', {});

      for (const pr of tr.spec?.parentRefs || []) {
        if (pr.name) {
          const gwNs = pr.namespace || ns;
          addNode(gwNs, 'Gateway', pr.name, 'abstract');
          addEdge(`${ns}/TCPRoute/${trName}`, `${gwNs}/Gateway/${pr.name}`, 'parent-gateway', 'spec.parentRefs');
        }
      }

      for (const rule of tr.spec?.rules || []) {
        for (const br of rule.backendRefs || []) {
          if (br.name) {
            const backendNs = br.namespace || ns;
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
      if (gwName) addNode(ns, 'Gateway', gwName, 'abstract', { gatewayClassName: gw.spec?.gatewayClassName });
    }

    const ingresses = getItemsFn(ns, 'ingresses');
    for (const ing of ingresses) {
      const ingName = ing.metadata?.name;
      if (!ingName) continue;
      addNode(ns, 'Ingress', ingName, 'abstract', {
        hosts: ing.spec?.rules?.map(r => r.host).filter(Boolean),
      });
      for (const rule of ing.spec?.rules || []) {
        for (const p of rule.http?.paths || []) {
          const backendName = p.backend?.service?.name || p.backend?.serviceName;
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
      addNode(ns, 'HorizontalPodAutoscaler', hpaName, 'abstract', {
        minReplicas: hpa.spec?.minReplicas,
        maxReplicas: hpa.spec?.maxReplicas,
      });
      const targetName = hpa.spec?.scaleTargetRef?.name;
      const targetKind = hpa.spec?.scaleTargetRef?.kind;
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
  const pods = {};
  for (const ns of namespaceList) {
    const podItems = getItemsFn(ns, 'pods');
    for (const pod of podItems) {
      const podName = pod.metadata?.name;
      if (!podName) continue;

      const phase = pod.status?.phase || 'Unknown';
      const containerStatuses = pod.status?.containerStatuses || [];
      let displayStatus = phase;
      for (const cs of containerStatuses) {
        if (cs.state?.waiting?.reason === 'CrashLoopBackOff') {
          displayStatus = 'CrashLoopBackOff';
          break;
        }
      }

      const image = pod.spec?.containers?.[0]?.image;
      const nodeName = pod.spec?.nodeName;
      const restarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);

      let ownerKind = null;
      let ownerName = null;
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

      const podNode = {
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

  const byKind = {};
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

module.exports = {
  FILE_ALIASES,
  discoverNamespaces,
  loadYamlFile,
  getItemsFromSnapshot,
  extractWorkloadEdges,
  buildGraph,
};
