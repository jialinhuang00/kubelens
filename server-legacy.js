const express = require('express');
const { exec, spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:4200",
    methods: ["GET", "POST"]
  }
});
const PORT = 3000;

// Mock mode: use backup data instead of real kubectl
const MOCK_MODE = process.env.MOCK_K8S === 'true';
let mockK8s = null;
if (MOCK_MODE) {
  mockK8s = require('./mock-k8s');
  console.log('🎭 MOCK MODE ENABLED - using backup data instead of real kubectl');
  console.log(`📂 Data path: ${process.env.MOCK_K8S_DATA || 'mock-data/'}`);
}

app.use(cors({
  origin: 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());

// Function to split kubectl get all output into separate tables
function splitGetAllTables(output) {
  const lines = output.split('\n');
  const tables = [];
  let currentTable = null;

  // Check if this is --all-namespaces output (has NAMESPACE column)
  const isAllNamespaces = output.includes('NAMESPACE');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip completely empty lines
    if (line.trim() === '') {
      // Empty line indicates end of current table
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    // Check if this is a header line
    const isHeaderLine = isAllNamespaces ?
      line.startsWith('NAMESPACE') :
      line.startsWith('NAME');

    if (isHeaderLine) {
      // If we have a current table, save it first
      if (currentTable && currentTable.lines.length > 1) {
        tables.push(currentTable);
      }

      // Start new table
      currentTable = {
        resourceType: 'Unknown',
        lines: [line],
        resourceTypeDetected: false
      };
      continue;
    }

    // This is a data line
    if (currentTable && line.trim()) {
      // If this is the first data line, detect resource type
      if (!currentTable.resourceTypeDetected) {
        const parts = line.trim().split(/\s+/);
        const resourceNameIndex = isAllNamespaces ? 1 : 0; // NAMESPACE NAME vs NAME

        if (parts.length > resourceNameIndex) {
          const resourceName = parts[resourceNameIndex];
          let resourceType = 'Resources';

          if (resourceName.includes('/')) {
            const resourcePrefix = resourceName.split('/')[0];
            switch (resourcePrefix.toLowerCase()) {
              case 'deployment.apps':
                resourceType = 'DEPLOYMENT';
                break;
              case 'replicaset.apps':
                resourceType = 'REPLICASET';
                break;
              case 'statefulset.apps':
                resourceType = 'STATEFULSET';
                break;
              case 'daemonset.apps':
                resourceType = 'DAEMONSET';
                break;
              case 'pod':
                resourceType = 'POD';
                break;
              case 'service':
                resourceType = 'SERVICE';
                break;
              case 'horizontalpodautoscaler.autoscaling':
                resourceType = 'HPA';
                break;
              case 'cronjob.batch':
                resourceType = 'CRONJOB';
                break;
              case 'job.batch':
                resourceType = 'JOB';
                break;
              default:
                // Try to make a reasonable name from the prefix
                resourceType = resourcePrefix.split('.')[0].toUpperCase();
                break;
            }
          }

          currentTable.resourceType = resourceType;
          currentTable.resourceTypeDetected = true;
        }
      }

      // Add the data line
      currentTable.lines.push(line);
    }
  }

  // Add the last table if exists
  if (currentTable && currentTable.lines.length > 1) {
    tables.push(currentTable);
  }

  // Format output with table titles
  let result = '';
  tables.forEach((table, index) => {
    if (index > 0) {
      result += '\n\n';
    }
    result += `=== ${table.resourceType} ===\n`;
    result += table.lines.join('\n');
  });

  return result;
}

// Execute kubectl commands
app.post('/api/execute', (req, res) => {
  const { command } = req.body;

  if (!command || !command.startsWith('kubectl')) {
    return res.status(400).json({
      error: 'Only kubectl commands are allowed',
      success: false
    });
  }

  // Mock mode: intercept and return backup data
  if (MOCK_MODE && mockK8s) {
    console.log(`[MOCK] Intercepting: ${command}`);
    const result = mockK8s.handleCommand(command);
    return res.json({
      success: result.success,
      stdout: result.stdout || '',
      error: result.error || undefined,
      command: command
    });
  }

  // dynamically create tempFile
  const tempFile = path.join(os.tmpdir(), `kubectl-${uuidv4()}.txt`);
  const fullCommand = `${command} > ${tempFile} 2>&1`;

  console.log(`Executing: ${command}`);

  // Simulate slow command for testing
  setTimeout(() => {
    exec(fullCommand, { timeout: 30000 }, (error) => {
      // read tempFile no matter success or fail.
      fs.readFile(tempFile, 'utf8', (readErr, data) => {
        // rm temp file
        fs.unlink(tempFile, () => { });

        if (readErr) {
          return res.status(500).json({
            success: false,
            error: 'Failed to read command output file',
            file: tempFile
          });
        }

        if (error) {
          // When kubectl command fails, show the actual error message from the output
          // instead of just the generic exec error message
          const actualErrorMessage = data.trim() || error.message;
          return res.json({
            success: false,
            error: actualErrorMessage,
            stdout: '', // no ambiguous here, frontend only see error.
            command: command
          });
        }

        // Check if this is "kubectl get all" and split tables
        let processedOutput = data;
        if (command.includes('get all')) {
          processedOutput = splitGetAllTables(data);
        }

        res.json({
          success: true,
          stdout: processedOutput,
          command: command
        });
      });
    })
  }, 3000);
});

// Health check
app.get('/api/health', (req, res) => {
  exec('which kubectl && kubectl version --client -o json', (error, stdout, stderr) => {
    const env_info = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      KUBECONFIG: process.env.KUBECONFIG,
      working_directory: process.cwd()
    };

    if (error) {
      return res.json({
        status: 'kubectl not available',
        error: error.message,
        environment: env_info,
        stderr: stderr
      });
    }

    const lines = stdout.split('\n');
    const kubectlPath = lines[0];
    const versionJson = lines.slice(1).join('\n');

    try {
      const version = JSON.parse(versionJson);
      res.json({
        status: 'healthy',
        kubectl: {
          path: kubectlPath,
          version: version.clientVersion?.gitVersion || 'unknown'
        },
        environment: env_info
      });
    } catch (e) {
      res.json({
        status: 'kubectl found but version parse failed',
        kubectl_path: kubectlPath,
        environment: env_info,
        raw_output: versionJson
      });
    }
  });
});

// 串流執行 kubectl 指令 (用於長時間運行的指令如 rollout status)
app.post('/api/execute/stream', (req, res) => {
  // Mock mode: return result immediately via socket instead of spawning process
  if (MOCK_MODE && mockK8s) {
    const { command, streamId } = req.body;
    console.log(`[MOCK] Stream intercepting: ${command}`);
    const result = mockK8s.handleCommand(command);
    res.json({ success: true, message: 'Stream started (mock)', streamId });
    // Emit the result via socket after a short delay to simulate streaming
    setTimeout(() => {
      io.emit('stream-data', { streamId, type: 'stdout', data: result.stdout || result.error || '', timestamp: Date.now() });
      setTimeout(() => {
        io.emit('stream-end', { streamId, exitCode: result.success ? 0 : 1, fullOutput: result.stdout || result.error || '', timestamp: Date.now() });
      }, 500);
    }, 300);
    return;
  }

  const { command, streamId } = req.body;

  if (!command || !command.startsWith('kubectl')) {
    return res.status(400).json({
      error: 'Only kubectl commands are allowed',
      success: false
    });
  }

  if (!streamId) {
    return res.status(400).json({
      error: 'streamId is required for streaming commands',
      success: false
    });
  }

  console.log(`Starting stream for: ${command} (ID: ${streamId})`);

  // start response, the streaming is starting.
  res.json({
    success: true,
    message: 'Stream started',
    streamId: streamId
  });

  // parse command and option
  const args = command.split(' ').slice(1); // rm 'kubectl'

  // using spawn for executing command, then getting realtime output
  const kubectlProcess = spawn('kubectl', args);

  // save process ref, for stopping later
  global.runningProcesses = global.runningProcesses || new Map();
  global.runningProcesses.set(streamId, kubectlProcess);

  let outputBuffer = '';

  // processing stdout
  kubectlProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    outputBuffer += chunk;

    // send realtime data to frontend
    io.emit('stream-data', {
      streamId: streamId,
      type: 'stdout',
      data: chunk,
      timestamp: Date.now()
    });
  });

  // processing stderr
  kubectlProcess.stderr.on('data', (data) => {
    const chunk = data.toString();
    outputBuffer += chunk;

    io.emit('stream-data', {
      streamId: streamId,
      type: 'stderr',
      data: chunk,
      timestamp: Date.now()
    });
  });

  // process is over
  kubectlProcess.on('close', (code) => {
    console.log(`Stream ${streamId} closed with code: ${code}`);

    io.emit('stream-end', {
      streamId: streamId,
      exitCode: code,
      fullOutput: outputBuffer,
      timestamp: Date.now()
    });

    // rm process ref
    global.runningProcesses.delete(streamId);
  });

  // process has error
  kubectlProcess.on('error', (error) => {
    console.error(`Stream ${streamId} error:`, error);

    io.emit('stream-error', {
      streamId: streamId,
      error: error.message,
      timestamp: Date.now()
    });

    global.runningProcesses.delete(streamId);
  });
});

// stop streaming
app.post('/api/execute/stream/stop', (req, res) => {
  const { streamId } = req.body;

  if (!streamId) {
    return res.status(400).json({ error: 'streamId is required' });
  }

  const process = global.runningProcesses?.get(streamId);
  if (process) {
    process.kill('SIGTERM');
    global.runningProcesses.delete(streamId);
    console.log(`Terminated stream: ${streamId}`);
    res.json({ success: true, message: 'Stream terminated' });
  } else {
    res.status(404).json({ error: 'Stream not found' });
  }
});

// ============================================================
// GET /api/graph — K8s resource graph for universe visualization
// Supports multi-namespace: scans backup directories for namespace subdirs
// ============================================================
app.get('/api/graph', (req, res) => {
  const yaml = require('js-yaml');

  // File name mapping: try backup-style names first, then legacy names
  const FILE_ALIASES = {
    'httproutes': ['httproutes.gateway.networking.k8s.io.yaml', 'httproutes.yaml'],
    'tcproutes': ['tcproutes.gateway.networking.k8s.io.yaml', 'tcproutes.yaml'],
    'gateways': ['gateways.gateway.networking.k8s.io.yaml', 'gateways.yaml'],
  };

  // Discover namespace directories from one or more data paths
  function discoverNamespaces(dataPaths) {
    const namespaces = new Map(); // name -> dirPath
    for (const dp of dataPaths) {
      if (!fs.existsSync(dp)) continue;
      // Check if this directory itself contains YAML files (flat layout, e.g. mock-data/)
      const entries = fs.readdirSync(dp, { withFileTypes: true });
      const hasYaml = entries.some(e => e.isFile() && e.name.endsWith('.yaml'));
      if (hasYaml && !entries.some(e => e.isDirectory() && !e.name.startsWith('.'))) {
        // Flat layout — treat the directory name as namespace
        const nsName = path.basename(dp) === 'mock-data' ? 'demo' : path.basename(dp);
        namespaces.set(nsName, dp);
      } else {
        // Nested layout — each subdirectory is a namespace
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

  function getItems(nsDir, resourceKey) {
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

  // Determine data paths — look in sibling mammoth-garage repo for real backup data
  const BACKUP_BASE = path.join(__dirname, '..', 'mammoth-garage', 'tooling', 'aws-scripts', 'k8s-backups');
  const defaultPaths = [
    path.join(BACKUP_BASE, 'k8s-backup-20260214-165937'),
  ];
  const fallbackPath = process.env.MOCK_K8S_DATA || path.join(__dirname, 'mock-data');

  let dataPaths;
  if (req.query.path) {
    dataPaths = [path.resolve(req.query.path)];
  } else if (defaultPaths.some(p => fs.existsSync(p))) {
    dataPaths = defaultPaths.filter(p => fs.existsSync(p));
  } else {
    dataPaths = [fallbackPath];
  }

  const namespaceDirs = discoverNamespaces(dataPaths);

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

  // Helper: extract configmap/secret/sa/pvc edges from a pod spec
  function extractWorkloadEdges(ns, kind, name, podSpec) {
    if (!podSpec) return;
    const sourceId = `${ns}/${kind}/${name}`;

    // serviceAccountName
    const sa = podSpec.serviceAccountName;
    if (sa && sa !== 'default') {
      addNode(ns, 'ServiceAccount', sa, 'security');
      addEdge(sourceId, `${ns}/ServiceAccount/${sa}`, 'uses-serviceaccount', 'spec.serviceAccountName');
    }

    // containers env / envFrom
    for (const container of podSpec.containers || []) {
      for (const ef of container.envFrom || []) {
        if (ef.configMapRef?.name) {
          addNode(ns, 'ConfigMap', ef.configMapRef.name, 'config');
          addEdge(sourceId, `${ns}/ConfigMap/${ef.configMapRef.name}`, 'uses-configmap', 'envFrom.configMapRef');
        }
        if (ef.secretRef?.name) {
          addNode(ns, 'Secret', ef.secretRef.name, 'config');
          addEdge(sourceId, `${ns}/Secret/${ef.secretRef.name}`, 'uses-secret', 'envFrom.secretRef');
        }
      }
      // Also check individual env valueFrom references
      for (const env of container.env || []) {
        if (env.valueFrom?.configMapKeyRef?.name) {
          addNode(ns, 'ConfigMap', env.valueFrom.configMapKeyRef.name, 'config');
          addEdge(sourceId, `${ns}/ConfigMap/${env.valueFrom.configMapKeyRef.name}`, 'uses-configmap', 'env.valueFrom.configMapKeyRef');
        }
        if (env.valueFrom?.secretKeyRef?.name) {
          addNode(ns, 'Secret', env.valueFrom.secretKeyRef.name, 'config');
          addEdge(sourceId, `${ns}/Secret/${env.valueFrom.secretKeyRef.name}`, 'uses-secret', 'env.valueFrom.secretKeyRef');
        }
      }
    }

    // init containers
    for (const container of podSpec.initContainers || []) {
      for (const ef of container.envFrom || []) {
        if (ef.configMapRef?.name) {
          addNode(ns, 'ConfigMap', ef.configMapRef.name, 'config');
          addEdge(sourceId, `${ns}/ConfigMap/${ef.configMapRef.name}`, 'uses-configmap', 'envFrom.configMapRef');
        }
        if (ef.secretRef?.name) {
          addNode(ns, 'Secret', ef.secretRef.name, 'config');
          addEdge(sourceId, `${ns}/Secret/${ef.secretRef.name}`, 'uses-secret', 'envFrom.secretRef');
        }
      }
      for (const env of container.env || []) {
        if (env.valueFrom?.configMapKeyRef?.name) {
          addNode(ns, 'ConfigMap', env.valueFrom.configMapKeyRef.name, 'config');
          addEdge(sourceId, `${ns}/ConfigMap/${env.valueFrom.configMapKeyRef.name}`, 'uses-configmap', 'env.valueFrom.configMapKeyRef');
        }
        if (env.valueFrom?.secretKeyRef?.name) {
          addNode(ns, 'Secret', env.valueFrom.secretKeyRef.name, 'config');
          addEdge(sourceId, `${ns}/Secret/${env.valueFrom.secretKeyRef.name}`, 'uses-secret', 'env.valueFrom.secretKeyRef');
        }
      }
    }

    // volumes
    for (const vol of podSpec.volumes || []) {
      if (vol.persistentVolumeClaim?.claimName) {
        const pvcName = vol.persistentVolumeClaim.claimName;
        addNode(ns, 'PersistentVolumeClaim', pvcName, 'storage');
        addEdge(sourceId, `${ns}/PersistentVolumeClaim/${pvcName}`, 'uses-pvc', 'volumes.persistentVolumeClaim');
      }
      if (vol.configMap?.name) {
        addNode(ns, 'ConfigMap', vol.configMap.name, 'config');
        addEdge(sourceId, `${ns}/ConfigMap/${vol.configMap.name}`, 'uses-configmap', 'volumes.configMap');
      }
      if (vol.secret?.secretName) {
        addNode(ns, 'Secret', vol.secret.secretName, 'config');
        addEdge(sourceId, `${ns}/Secret/${vol.secret.secretName}`, 'uses-secret', 'volumes.secret');
      }
      if (vol.projected?.sources) {
        for (const src of vol.projected.sources) {
          if (src.configMap?.name) {
            addNode(ns, 'ConfigMap', src.configMap.name, 'config');
            addEdge(sourceId, `${ns}/ConfigMap/${src.configMap.name}`, 'uses-configmap', 'volumes.projected.configMap');
          }
          if (src.secret?.name) {
            addNode(ns, 'Secret', src.secret.name, 'config');
            addEdge(sourceId, `${ns}/Secret/${src.secret.name}`, 'uses-secret', 'volumes.projected.secret');
          }
        }
      }
    }
  }

  // --- Process each namespace ---
  for (const [ns, nsDir] of namespaceDirs) {
    allNamespaces.push(ns);

    // Workloads: Deployments
    const deployments = getItems(nsDir, 'deployments');
    for (const d of deployments) {
      const name = d.metadata?.name;
      if (!name) continue;
      addNode(ns, 'Deployment', name, 'workload', {
        replicas: d.spec?.replicas,
        image: d.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'Deployment', name, d.spec?.template?.spec);
    }

    // Workloads: StatefulSets
    const statefulsets = getItems(nsDir, 'statefulsets');
    for (const s of statefulsets) {
      const name = s.metadata?.name;
      if (!name) continue;
      addNode(ns, 'StatefulSet', name, 'workload', {
        replicas: s.spec?.replicas,
        image: s.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'StatefulSet', name, s.spec?.template?.spec);
    }

    // Workloads: DaemonSets
    const daemonsets = getItems(nsDir, 'daemonsets');
    for (const ds of daemonsets) {
      const name = ds.metadata?.name;
      if (!name) continue;
      addNode(ns, 'DaemonSet', name, 'workload', {
        image: ds.spec?.template?.spec?.containers?.[0]?.image,
      });
      extractWorkloadEdges(ns, 'DaemonSet', name, ds.spec?.template?.spec);
    }

    // Workloads: CronJobs
    const cronjobs = getItems(nsDir, 'cronjobs');
    for (const c of cronjobs) {
      const name = c.metadata?.name;
      if (!name) continue;
      addNode(ns, 'CronJob', name, 'workload', { schedule: c.spec?.schedule });
      extractWorkloadEdges(ns, 'CronJob', name, c.spec?.jobTemplate?.spec?.template?.spec);
    }

    // Collect all workloads for service selector matching
    const allWorkloads = [
      ...deployments.map(d => ({ kind: 'Deployment', item: d })),
      ...statefulsets.map(s => ({ kind: 'StatefulSet', item: s })),
      ...daemonsets.map(ds => ({ kind: 'DaemonSet', item: ds })),
    ];

    // Services
    const services = getItems(nsDir, 'services');
    for (const svc of services) {
      const svcName = svc.metadata?.name;
      if (!svcName) continue;
      const selector = svc.spec?.selector;
      if (!selector) continue;
      addNode(ns, 'Service', svcName, 'networking', {
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

    // HTTPRoutes (with cross-namespace gateway support)
    const httproutes = getItems(nsDir, 'httproutes');
    for (const hr of httproutes) {
      const hrName = hr.metadata?.name;
      if (!hrName) continue;
      addNode(ns, 'HTTPRoute', hrName, 'networking', { hostnames: hr.spec?.hostnames });

      for (const pr of hr.spec?.parentRefs || []) {
        if (pr.name) {
          const gwNs = pr.namespace || ns;
          addNode(gwNs, 'Gateway', pr.name, 'networking');
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

    // TCPRoutes
    const tcproutes = getItems(nsDir, 'tcproutes');
    for (const tr of tcproutes) {
      const trName = tr.metadata?.name;
      if (!trName) continue;
      addNode(ns, 'TCPRoute', trName, 'networking', {});

      for (const pr of tr.spec?.parentRefs || []) {
        if (pr.name) {
          const gwNs = pr.namespace || ns;
          addNode(gwNs, 'Gateway', pr.name, 'networking');
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

    // Gateways (add any not yet added)
    const gateways = getItems(nsDir, 'gateways');
    for (const gw of gateways) {
      const gwName = gw.metadata?.name;
      if (gwName) addNode(ns, 'Gateway', gwName, 'networking', { gatewayClassName: gw.spec?.gatewayClassName });
    }

    // Ingresses
    const ingresses = getItems(nsDir, 'ingresses');
    for (const ing of ingresses) {
      const ingName = ing.metadata?.name;
      if (!ingName) continue;
      addNode(ns, 'Ingress', ingName, 'networking', {
        hosts: ing.spec?.rules?.map(r => r.host).filter(Boolean),
      });
      // Link to backend services
      for (const rule of ing.spec?.rules || []) {
        for (const p of rule.http?.paths || []) {
          const backendName = p.backend?.service?.name || p.backend?.serviceName;
          if (backendName && nodeIds.has(`${ns}/Service/${backendName}`)) {
            addEdge(`${ns}/Ingress/${ingName}`, `${ns}/Service/${backendName}`, 'routes-to', 'spec.rules.http.paths.backend');
          }
        }
      }
    }

    // HorizontalPodAutoscalers
    const hpas = getItems(nsDir, 'horizontalpodautoscalers');
    for (const hpa of hpas) {
      const hpaName = hpa.metadata?.name;
      if (!hpaName) continue;
      addNode(ns, 'HorizontalPodAutoscaler', hpaName, 'security', {
        minReplicas: hpa.spec?.minReplicas,
        maxReplicas: hpa.spec?.maxReplicas,
      });
      // Link to scale target
      const targetName = hpa.spec?.scaleTargetRef?.name;
      const targetKind = hpa.spec?.scaleTargetRef?.kind;
      if (targetName && targetKind) {
        const targetId = `${ns}/${targetKind}/${targetName}`;
        if (nodeIds.has(targetId)) {
          addEdge(`${ns}/HorizontalPodAutoscaler/${hpaName}`, targetId, 'exposes', 'spec.scaleTargetRef');
        }
      }
    }

    // RoleBindings
    const rolebindings = getItems(nsDir, 'rolebindings');
    for (const rb of rolebindings) {
      const rbName = rb.metadata?.name;
      if (!rbName) continue;
      addNode(ns, 'RoleBinding', rbName, 'security');

      if (rb.roleRef?.name) {
        addNode(ns, 'Role', rb.roleRef.name, 'security');
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

    // Orphan detection: load ALL ConfigMaps, mark unreferenced ones
    // Skip orphan Secrets — K8s auto-generates many SA token secrets that clutter the graph
    const allConfigMaps = getItems(nsDir, 'configmaps');
    for (const cm of allConfigMaps) {
      const cmName = cm.metadata?.name;
      if (!cmName) continue;
      const cmId = `${ns}/ConfigMap/${cmName}`;
      if (!nodeIds.has(cmId)) {
        addNode(ns, 'ConfigMap', cmName, 'config', { orphan: true });
      }
    }
  }

  // --- Parse Pods (separate from main nodes — loaded on demand by frontend) ---
  const pods = {}; // key: parent workload node ID, value: array of pod nodes
  for (const [ns, nsDir] of namespaceDirs) {
    const podItems = getItems(nsDir, 'pods');
    for (const pod of podItems) {
      const podName = pod.metadata?.name;
      if (!podName) continue;

      const phase = pod.status?.phase || 'Unknown';
      const containerStatuses = pod.status?.containerStatuses || [];
      // Detect CrashLoopBackOff from container statuses
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

      // Resolve owner: Pod → ReplicaSet → Deployment, or Pod → StatefulSet/Job → CronJob
      let ownerKind = null;
      let ownerName = null;
      const ownerRefs = pod.metadata?.ownerReferences || [];
      for (const ref of ownerRefs) {
        if (ref.kind === 'ReplicaSet') {
          // ReplicaSet name = "{deployment-name}-{hash}", strip the last "-{hash}"
          const rsName = ref.name;
          const lastDash = rsName.lastIndexOf('-');
          ownerName = lastDash > 0 ? rsName.substring(0, lastDash) : rsName;
          ownerKind = 'Deployment';
        } else if (ref.kind === 'StatefulSet') {
          ownerKind = 'StatefulSet';
          ownerName = ref.name;
        } else if (ref.kind === 'Job') {
          // Job name for CronJob = "{cronjob-name}-{timestamp}", strip last "-{timestamp}"
          const jobName = ref.name;
          const lastDash = jobName.lastIndexOf('-');
          const possibleCronJob = lastDash > 0 ? jobName.substring(0, lastDash) : jobName;
          // Check if a CronJob node exists with this name
          if (nodeIds.has(`${ns}/CronJob/${possibleCronJob}`)) {
            ownerKind = 'CronJob';
            ownerName = possibleCronJob;
          } else {
            ownerKind = 'Job';
            ownerName = ref.name;
          }
        }
      }

      if (!ownerKind || !ownerName) continue; // skip orphan pods

      const parentId = `${ns}/${ownerKind}/${ownerName}`;
      if (!nodeIds.has(parentId)) continue; // skip if parent workload not in graph

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

  // Build stats
  const byKind = {};
  for (const n of nodes) {
    byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  }

  res.json({
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
  });
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 kubecmds-viz server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔌 WebSocket server ready for streaming`);
});