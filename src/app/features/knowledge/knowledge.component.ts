import {
  Component, OnInit, AfterViewChecked,
  ViewChild, ViewChildren, ElementRef, QueryList,
  signal, computed, inject, effect,
} from '@angular/core';
import { Router } from '@angular/router';
import { GraphDataService } from '../universe/services/graph-data.service';
import { DataModeService } from '../../core/services/data-mode.service';
import { ThemeService } from '../../core/services/theme.service';
import { BackLinkComponent } from '../../shared/components/back-link/back-link.component';
import { NamespaceChipsComponent } from '../../shared/components/namespace-chips/namespace-chips.component';
import { ThemeSwitcherComponent } from '../../shared/components/theme-switcher/theme-switcher.component';
import { NetworkPatternsComponent, type NetworkType } from './network-patterns/network-patterns.component';
import {
  GraphNode, GraphEdge,
  EdgeType, SourceField, NodeKind,
  getThemedEdgeColors,
} from '../universe/models/graph.models';

// ── Field Glossary data ────────────────────────────────────────────────────

export interface RuntimeStep {
  kind: string;
  name: string;
  label: string;
}

export interface FieldInfo {
  short: string;
  yaml: string;
  edgeType: EdgeType;
  notes: string;
  usage: string[];
  runtimeChain?: RuntimeStep[];
  groupKind?: NodeKind;
}

export const FIELD_GLOSSARY: Record<SourceField, FieldInfo> = {
  [SourceField.ServiceAccountName]: {
    short: 'Runs as ServiceAccount',
    yaml: 'spec.template.spec.serviceAccountName',
    edgeType: EdgeType.UsesServiceAccount,
    notes: 'Deployment tells K8s which ServiceAccount to use. At runtime, K8s mounts the SA token into every Pod at a well-known path. The container process reads that token to authenticate against the K8s API. Default SA has minimal permissions — create a dedicated SA and bind a Role to it.',
    usage: [
      '// Node.js — @kubernetes/client-node',
      'kc.loadFromCluster()  // reads token from auto-mounted path',
      '// token path: /var/run/secrets/kubernetes.io/serviceaccount/token',
    ],
    runtimeChain: [
      { kind: 'Pod',     name: 'my-app-xyz',     label: 'creates → mounts SA token' },
      { kind: 'K8s API', name: 'kube-apiserver', label: 'authenticates with token' },
    ],
  },
  [SourceField.EnvFromConfigMap]: {
    short: 'Loads all keys from ConfigMap (env)',
    yaml: 'containers[].envFrom[].configMapRef',
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Bulk-imports every key from ConfigMap as env vars. Key name = env var name, cannot rename. Use when the ConfigMap is purpose-built for this app. If it is shared across apps, use configMapKeyRef instead.',
    usage: [
      'process.env.DB_HOST        // ConfigMap key: DB_HOST',
      'process.env.APP_PORT       // ConfigMap key: APP_PORT',
      '# .env equivalent: DB_HOST=postgres',
    ],
  },
  [SourceField.EnvFromSecret]: {
    short: 'Loads all keys from Secret (env)',
    yaml: 'containers[].envFrom[].secretRef',
    edgeType: EdgeType.UsesSecret,
    notes: 'Bulk-imports every key from the Secret as env vars. Use when the Secret belongs exclusively to this app. If other apps share the same Secret, or you only need a subset of keys, use secretKeyRef instead.',
    usage: [
      'process.env.DB_PASSWORD    // Secret key: DB_PASSWORD',
      'process.env.API_KEY        // Secret key: API_KEY',
    ],
  },
  [SourceField.EnvConfigMapKey]: {
    short: 'Reads one key from ConfigMap',
    yaml: 'containers[].env[].valueFrom.configMapKeyRef',
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Picks a single key from ConfigMap. You control the env var name via the name field. Use when the ConfigMap is shared across apps, you need to rename the key, or only a subset of keys is relevant.',
    usage: [
      '// ConfigMap key: db_host → env var: DATABASE_HOST',
      'process.env.DATABASE_HOST  // your chosen name',
    ],
  },
  [SourceField.EnvSecretKey]: {
    short: 'Reads one key from Secret',
    yaml: 'containers[].env[].valueFrom.secretKeyRef',
    edgeType: EdgeType.UsesSecret,
    notes: 'Picks a single key from the Secret and lets you rename it. Use when the Secret is shared across apps, you only need a subset of keys, or the key name differs from what your app expects as an env var.',
    usage: [
      'process.env.JWT_SECRET     // Secret key: JWT_SECRET',
      'process.env.DATABASE_URL   // Secret key: DATABASE_URL',
      'process.env.OTHER_KEY      // undefined — not listed in env[], must add another secretKeyRef',
    ],
  },
  [SourceField.VolumePVC]: {
    short: 'Mounts PVC as volume',
    yaml: 'volumes[].persistentVolumeClaim.claimName',
    edgeType: EdgeType.UsesPVC,
    notes: 'Persistent block/file storage. Survives pod restarts and rescheduling. Use for databases, uploaded files, ML model storage. Data lives in the PVC, not the container image.',
    usage: [
      "fs.readFileSync('/data/uploads/file.pdf')",
      '// mount path defined in volumeMounts[].mountPath',
    ],
  },
  [SourceField.VolumeConfigMap]: {
    short: 'Mounts ConfigMap as volume',
    yaml: 'volumes[].configMap.name',
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Each key in the ConfigMap becomes a file. Use for config files (nginx.conf, app.json, prometheus.yml) instead of env vars — better for multi-line values or structured config.',
    usage: [
      "fs.readFileSync('/etc/config/app.json', 'utf8')",
      '// key name = filename inside the mount path',
    ],
  },
  [SourceField.VolumeSecret]: {
    short: 'Mounts Secret as volume',
    yaml: 'volumes[].secret.secretName',
    edgeType: EdgeType.UsesSecret,
    notes: 'Same as VolumeConfigMap but for Secrets. Preferred for TLS certs, SSH keys, kubeconfig — binary or multi-line data that does not fit cleanly as env vars.',
    usage: [
      "fs.readFileSync('/etc/certs/tls.crt')",
      "fs.readFileSync('/etc/ssh/id_rsa')",
    ],
  },
  [SourceField.ProjectedConfigMap]: {
    short: 'Projected ConfigMap volume',
    yaml: 'volumes[].projected.sources[].configMap',
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Projected volumes combine multiple ConfigMaps and/or Secrets into a single mount path. Use when you need config + certs in the same directory, or want to merge multiple ConfigMaps.',
    usage: [
      '// same as VolumeConfigMap — access via file path',
      "fs.readFileSync('/etc/combined/app.json', 'utf8')",
    ],
  },
  [SourceField.ProjectedSecret]: {
    short: 'Projected Secret volume',
    yaml: 'volumes[].projected.sources[].secret',
    edgeType: EdgeType.UsesSecret,
    notes: 'Same as ProjectedConfigMap but for Secrets. Often combined with ServiceAccount token projection for custom token audiences.',
    usage: [
      "fs.readFileSync('/etc/combined/tls.crt')",
    ],
  },
  [SourceField.Selector]: {
    short: 'Service selects workload pods',
    yaml: 'spec.selector',
    edgeType: EdgeType.Exposes,
    notes: 'Service uses label selector to find pods. Labels on the pod template must match — if they do not, the service routes to 0 pods. ClusterIP, NodePort, and LoadBalancer all use this mechanism.',
    usage: [
      '// in Node.js: call service by DNS name',
      "fetch('http://my-svc:80/api')  // K8s DNS resolves to ClusterIP",
      '// load balanced across all matching pods',
    ],
  },
  [SourceField.ParentRefs]: {
    short: 'Route attaches to Gateway',
    yaml: 'spec.parentRefs[].name',
    edgeType: EdgeType.ParentGateway,
    notes: 'Gateway API (newer than Ingress). HTTPRoute attaches to a Gateway (like an ingress controller). Gateway handles TLS termination; HTTPRoute defines routing rules. Supports traffic splitting, header matching.',
    usage: [
      '// external traffic: https://api.example.com → Gateway → HTTPRoute → Service',
    ],
  },
  [SourceField.BackendRefs]: {
    short: 'Route forwards traffic to Service',
    yaml: 'spec.rules[].backendRefs[].name',
    edgeType: EdgeType.RoutesTo,
    notes: 'HTTPRoute forwards to a Service backend. Supports weighted routing for canary deploys — split traffic between two service versions by percentage.',
    usage: [
      '# canary deploy',
      'backendRefs:',
      '  - name: my-app-v1  weight: 90',
      '  - name: my-app-v2  weight: 10',
    ],
  },
  [SourceField.IngressBackend]: {
    short: 'Ingress forwards to Service backend',
    yaml: 'spec.rules[].http.paths[].backend.service.name',
    edgeType: EdgeType.RoutesTo,
    notes: 'Classic Ingress (pre-Gateway API). Routes HTTP traffic to Services based on host and path. Widely supported but less flexible than Gateway API — no traffic splitting, limited header rules.',
    usage: [
      '# host: api.example.com + path: /v1/* → service',
      "fetch('https://api.example.com/v1/users')",
    ],
  },
  [SourceField.ScaleTargetRef]: {
    short: 'HPA scales this workload',
    yaml: 'spec.scaleTargetRef.name',
    edgeType: EdgeType.Exposes,
    notes: 'HPA continuously monitors metrics (CPU, memory, custom) and adjusts replica count. Pod gets more replicas under load, scales down when idle. Works with Deployment and StatefulSet.',
    usage: [
      '# config: minReplicas: 2, maxReplicas: 10',
      '# targetCPUUtilizationPercentage: 70',
      '// no code change needed — K8s handles scaling',
    ],
  },
  [SourceField.RoleRef]: {
    short: 'RoleBinding binds this Role',
    yaml: 'roleRef.name',
    edgeType: EdgeType.BindsRole,
    groupKind: 'RoleBinding',
    notes: 'RoleBinding is the bridge: roleRef points to a Role (what is allowed), subjects points to a ServiceAccount (who gets it). Without a RoleBinding, a Role grants nothing — it is just a list of permissions with no owner. ClusterRole/ClusterRoleBinding for cluster-wide scope.',
    usage: [
      '// allow SA to list pods:',
      '// Role: verbs: [get, list], resources: [pods]',
      '// RoleBinding: roleRef → Role, subjects → ServiceAccount',
    ],
  },
  [SourceField.Subjects]: {
    short: 'RoleBinding grants access to ServiceAccount',
    yaml: 'subjects[].name',
    edgeType: EdgeType.BindsRole,
    groupKind: 'RoleBinding',
    notes: "The ServiceAccount name here must match the serviceAccountName on the workload pod spec. If they do not match, the pod runs but without the Role's permissions — silent failure.",
    usage: [
      '// subjects[].name === spec.template.spec.serviceAccountName',
      '// mismatch = silent failure (403 when calling K8s API)',
    ],
  },
  [SourceField.OwnerReference]: {
    short: 'Pod/ReplicaSet records its owner (set by K8s, not the user)',
    yaml: 'metadata.ownerReferences[].name',
    edgeType: EdgeType.Owns,
    notes: 'Written by K8s automatically — not by users. Tracks parent-child ownership: Deployment → ReplicaSet → Pod. Enables cascading deletes: delete Deployment, K8s walks ownerReferences to clean up everything.',
    usage: [
      'kubectl delete deployment my-app',
      '// K8s follows ownerReferences → deletes ReplicaSets → deletes Pods',
      '// also used by garbage collector for orphaned resources',
    ],
  },
  [SourceField.IngressTLS]: {
    short: 'Ingress TLS terminates with a Secret',
    yaml: 'spec.tls[].secretName',
    edgeType: EdgeType.UsesSecret,
    notes: 'The Secret must contain tls.crt and tls.key. Ingress controller reads the Secret at runtime and presents the certificate to clients. If the Secret is missing or malformed, TLS handshakes fail silently — always test with curl -v.',
    usage: [
      'curl -v https://my-app.example.com',
      '// check: * SSL certificate verify ok',
      '// if Secret missing → SSL_ERROR_RX_RECORD_TOO_LONG',
    ],
  },
};

// ── Static examples (pure K8s knowledge, no cluster data needed) ──────────

const STATIC_EXAMPLES: Record<SourceField, { srcKind: NodeKind; srcName: string; tgtKind: NodeKind; tgtName: string }> = {
  [SourceField.ServiceAccountName]: { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'ServiceAccount',        tgtName: 'my-app-sa' },
  [SourceField.EnvFromConfigMap]:   { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'ConfigMap',             tgtName: 'app-config' },
  [SourceField.EnvFromSecret]:      { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'Secret',                tgtName: 'app-secret' },
  [SourceField.EnvConfigMapKey]:    { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'ConfigMap',             tgtName: 'app-config' },
  [SourceField.EnvSecretKey]:       { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'Secret',                tgtName: 'app-secret' },
  [SourceField.VolumePVC]:          { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'PersistentVolumeClaim', tgtName: 'data-pvc' },
  [SourceField.VolumeConfigMap]:    { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'ConfigMap',             tgtName: 'app-config' },
  [SourceField.VolumeSecret]:       { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'Secret',                tgtName: 'tls-secret' },
  [SourceField.ProjectedConfigMap]: { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'ConfigMap',             tgtName: 'app-config' },
  [SourceField.ProjectedSecret]:    { srcKind: 'Deployment',              srcName: 'my-app',        tgtKind: 'Secret',                tgtName: 'app-secret' },
  [SourceField.Selector]:           { srcKind: 'Service',                 srcName: 'my-svc',        tgtKind: 'Pod',                   tgtName: 'my-app' },
  [SourceField.ParentRefs]:         { srcKind: 'HTTPRoute',               srcName: 'my-route',      tgtKind: 'Gateway',               tgtName: 'my-gateway' },
  [SourceField.BackendRefs]:        { srcKind: 'HTTPRoute',               srcName: 'my-route',      tgtKind: 'Service',               tgtName: 'my-svc' },
  [SourceField.IngressBackend]:     { srcKind: 'Ingress',                 srcName: 'my-ingress',    tgtKind: 'Service',               tgtName: 'my-svc' },
  [SourceField.ScaleTargetRef]:     { srcKind: 'HorizontalPodAutoscaler', srcName: 'my-hpa',        tgtKind: 'Deployment',            tgtName: 'my-app' },
  [SourceField.RoleRef]:            { srcKind: 'RoleBinding',             srcName: 'my-binding',    tgtKind: 'Role',                  tgtName: 'my-role' },
  [SourceField.Subjects]:           { srcKind: 'RoleBinding',             srcName: 'my-binding',    tgtKind: 'ServiceAccount',        tgtName: 'my-app-sa' },
  [SourceField.OwnerReference]:     { srcKind: 'Pod',                     srcName: 'my-app-abc12',  tgtKind: 'ReplicaSet',            tgtName: 'my-app-7f9b2' },
  [SourceField.IngressTLS]:         { srcKind: 'Ingress',                 srcName: 'my-ingress',    tgtKind: 'Secret',                tgtName: 'tls-secret' },
};

// ── YAML snippet builder ───────────────────────────────────────────────────

export interface YamlLine {
  text: string;
  highlight: boolean;
}

function buildSnippet(
  field: SourceField,
  src: GraphNode,
  tgt: GraphNode,
): { sourceLines: YamlLine[]; targetLines: YamlLine[] } {
  const s = (text: string, highlight = false): YamlLine => ({ text, highlight });
  const name = tgt.name;

  const targetLines = ((): YamlLine[] => {
    if (tgt.kind === 'Role') {
      return [
        s('# Role'),
        s('metadata:'),
        s(`  name: ${name}`, true),
        s('rules:'),
        s('  - apiGroups: [""]'),
        s('    resources: [pods]'),
        s('    verbs: [get, list]'),
      ];
    }
    if (tgt.kind === 'ConfigMap' || tgt.kind === 'Secret' || tgt.kind === 'PersistentVolumeClaim'
        || tgt.kind === 'ServiceAccount') {
      return [
        s(`# ${tgt.kind}`),
        s('metadata:'),
        s(`  name: ${name}`, true),
      ];
    }
    if (tgt.kind === 'Deployment' || tgt.kind === 'StatefulSet' || tgt.kind === 'DaemonSet') {
      return [
        s(`# ${tgt.kind}`),
        s('metadata:'),
        s(`  name: ${name}`, true),
        s('spec:'),
        s('  template:'),
        s('    metadata:'),
        s('      labels:'),
        s(`        app: ${name}`, true),
      ];
    }
    if (tgt.kind === 'Pod') {
      return [
        s(`# ${tgt.kind}`),
        s('metadata:'),
        s(`  name: ${name}`),
        s('  labels:'),
        s(`    app: ${name}`, true),
      ];
    }
    return [s(`# ${tgt.kind}`), s('metadata:'), s(`  name: ${name}`, true)];
  })();

  const sourceLines = ((): YamlLine[] => {
    switch (field) {
      case SourceField.EnvFromConfigMap:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      containers:'),
          s('        - envFrom:'),
          s('            - configMapRef:'),
          s(`                name: ${name}`, true),
        ];
      case SourceField.EnvFromSecret:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      containers:'),
          s('        - envFrom:'),
          s('            - secretRef:'),
          s(`                name: ${name}`, true),
        ];
      case SourceField.EnvConfigMapKey:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      containers:'),
          s('        - env:'),
          s('            - name: DATABASE_HOST'),
          s('              valueFrom:'),
          s('                configMapKeyRef:'),
          s(`                  name: ${name}`, true),
          s('                  key: db_host'),
          s('            - name: APP_PORT'),
          s('              valueFrom:'),
          s('                configMapKeyRef:'),
          s(`                  name: ${name}`),
          s('                  key: app_port'),
        ];
      case SourceField.EnvSecretKey:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      containers:'),
          s('        - env:'),
          s('            - name: JWT_SECRET'),
          s('              valueFrom:'),
          s('                secretKeyRef:'),
          s(`                  name: ${name}`, true),
          s('                  key: JWT_SECRET'),
          s('            - name: DATABASE_URL'),
          s('              valueFrom:'),
          s('                secretKeyRef:'),
          s(`                  name: ${name}`),
          s('                  key: DATABASE_URL'),
        ];
      case SourceField.VolumePVC:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: data'),
          s('          persistentVolumeClaim:'),
          s(`            claimName: ${name}`, true),
          s('      containers:'),
          s('        - volumeMounts:'),
          s('            - name: data'),
          s('              mountPath: /data'),
        ];
      case SourceField.VolumeConfigMap:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: config'),
          s('          configMap:'),
          s(`            name: ${name}`, true),
          s('      containers:'),
          s('        - volumeMounts:'),
          s('            - name: config'),
          s('              mountPath: /etc/config'),
          s('              # each key → a file in /etc/config/'),
        ];
      case SourceField.VolumeSecret:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: tls'),
          s('          secret:'),
          s(`            secretName: ${name}`, true),
          s('      containers:'),
          s('        - volumeMounts:'),
          s('            - name: tls'),
          s('              mountPath: /etc/certs'),
          s('              readOnly: true'),
        ];
      case SourceField.ProjectedConfigMap:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: combined'),
          s('          projected:'),
          s('            sources:'),
          s('              - configMap:'),
          s(`                  name: ${name}`, true),
          s('              - secret:'),
          s('                  name: tls-secret'),
          s('      containers:'),
          s('        - volumeMounts:'),
          s('            - name: combined'),
          s('              mountPath: /etc/combined'),
        ];
      case SourceField.ProjectedSecret:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: combined'),
          s('          projected:'),
          s('            sources:'),
          s('              - configMap:'),
          s('                  name: app-config'),
          s('              - secret:'),
          s(`                  name: ${name}`, true),
          s('      containers:'),
          s('        - volumeMounts:'),
          s('            - name: combined'),
          s('              mountPath: /etc/combined'),
        ];
      case SourceField.ServiceAccountName:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s(`      serviceAccountName: ${name}`, true),
        ];
      case SourceField.Selector:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  selector:'),
          s(`    app: ${name}`, true),
        ];
      case SourceField.ParentRefs:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  parentRefs:'),
          s(`    - name: ${name}`, true),
        ];
      case SourceField.BackendRefs:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  rules:'),
          s('    - backendRefs:'),
          s(`        - name: ${name}`, true),
        ];
      case SourceField.IngressBackend:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  rules:'),
          s('    - http:'),
          s('        paths:'),
          s('          - backend:'),
          s('              service:'),
          s(`                name: ${name}`, true),
        ];
      case SourceField.IngressTLS:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  tls:'),
          s('    - hosts:'),
          s('        - my-app.example.com'),
          s(`      secretName: ${name}`, true),
        ];
      case SourceField.ScaleTargetRef:
        return [
          s(`# ${src.kind}`),
          s('spec:'),
          s('  scaleTargetRef:'),
          s(`    name: ${name}`, true),
        ];
      case SourceField.RoleRef:
        return [
          s(`# ${src.kind}`),
          s('roleRef:'),
          s('  apiGroup: rbac.authorization.k8s.io'),
          s(`  name: ${name}`, true),
        ];
      case SourceField.Subjects:
        return [
          s(`# ${src.kind}`),
          s('subjects:'),
          s('  - kind: ServiceAccount'),
          s(`    name: ${name}`, true),
        ];
      case SourceField.OwnerReference:
        return [
          s(`# ${src.kind}`),
          s('metadata:'),
          s('  ownerReferences:'),
          s(`    - kind: ${tgt.kind}`),
          s(`      name: ${name}`, true),
          s('      controller: true'),
        ];
      default:
        return [s(`# ${src.kind}`), s(`  ref: ${name}`, true)];
    }
  })();

  return { sourceLines, targetLines };
}

// ── Multi-example (one source → many targets) ─────────────────────────────

export interface PodRow {
  podNode: GraphNode;
  ownerNode: GraphNode;
  sourceLines: YamlLine[];
  targetLines: YamlLine[];
}

export interface MultiExampleView {
  sourceNode: GraphNode;
  combinedLines: YamlLine[];
  targets: Array<{
    targetNode: GraphNode;
    edge: GraphEdge;
    targetLines: YamlLine[];
  }>;
  podRows?: PodRow[];
  emptyMsg?: string;
}

/** Kinds that have interesting multi-edge outgoing relationships. */
// ── Pod Config Keys ────────────────────────────────────────────────────────

export interface PodConfigEntry {
  key: string;
  short: string;
  appearsIn: string;
  what: string;
  yaml: string;
  trap: string;
}

export const POD_CONFIG_KEYS: PodConfigEntry[] = [
  {
    key: 'livenessProbe',
    short: 'Restart on health failure',
    appearsIn: 'containers[] — Deployment · StatefulSet · DaemonSet · Job',
    what: 'kubelet pings a health endpoint on a schedule. Three failures in a row — it kills and restarts the container. Fixes deadlocked processes that are still running but no longer responding.',
    yaml: `livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 3
  periodSeconds: 10`,
    trap: 'initialDelaySeconds too short — the app hasn\'t finished starting, the probe fires and fails, the container restarts before it ever ran. Use startupProbe instead.',
  },
  {
    key: 'readinessProbe',
    short: 'Drop from Service endpoints on failure',
    appearsIn: 'containers[] — Deployment · StatefulSet · DaemonSet · Job',
    what: 'Failure does not restart anything. It removes the Pod from the Service\'s endpoint list — traffic stops arriving, the container keeps running. Critical during rolling deploys: new Pod must pass readiness before old Pod drains.',
    yaml: `readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  failureThreshold: 3
  periodSeconds: 5`,
    trap: 'Using liveness where readiness is correct. A slow database connection causes container restarts instead of just falling out of rotation.',
  },
  {
    key: 'startupProbe',
    short: 'Gate liveness until app has booted',
    appearsIn: 'containers[] — Deployment · StatefulSet · DaemonSet · Job',
    what: 'Runs first, repeatedly, until it succeeds. Only then does liveness take over. Eliminates the guesswork of initialDelaySeconds for slow-starting apps.',
    yaml: `startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30  # 30 × 2s = 60s max boot time
  periodSeconds: 2`,
    trap: 'Few people know this exists — it shipped in 1.16. Most teams reach for initialDelaySeconds and accept the guesswork.',
  },
  {
    key: 'nodeAffinity',
    short: 'Schedule on specific node types',
    appearsIn: 'spec.affinity — Deployment · StatefulSet · DaemonSet · Job',
    what: 'Two modes: required (hard rule, no match = unschedulable) and preferred (soft rule, scheduler tries then moves on). The IgnoredDuringExecution suffix means: if a node label changes after scheduling, the Pod stays — it is not evicted.',
    yaml: `affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: topology.kubernetes.io/zone
              operator: In
              values: [us-east-1a]`,
    trap: 'matchExpressions supports In, NotIn, Exists, DoesNotExist. Most people discover this when matchLabels does not support what they need.',
  },
  {
    key: 'podAntiAffinity',
    short: 'Spread replicas across nodes or zones',
    appearsIn: 'spec.affinity — Deployment · StatefulSet · DaemonSet',
    what: 'Tells the scheduler: do not place this Pod next to another Pod with these labels. topologyKey defines "next to" — kubernetes.io/hostname means same node, topology.kubernetes.io/zone means same zone.',
    yaml: `affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: my-app
        topologyKey: kubernetes.io/hostname`,
    trap: 'Using preferred instead of required. Not enough nodes? The scheduler ignores the preference and packs them anyway — you get false protection.',
  },
  {
    key: 'topologySpreadConstraints',
    short: 'Evenly spread Pods across zones',
    appearsIn: 'spec — Deployment · StatefulSet · DaemonSet',
    what: 'podAntiAffinity is binary. topologySpreadConstraints can say "spread evenly". maxSkew: 1 means the difference between the busiest zone and least busy must be at most 1.',
    yaml: `topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: my-app`,
    trap: 'whenUnsatisfiable: DoNotSchedule blocks scheduling if no valid spread exists. A new node that has not joined yet stalls your deploy. Use ScheduleAnyway for best-effort.',
  },
  {
    key: 'resources.requests / limits',
    short: 'Scheduler hint vs kernel cap',
    appearsIn: 'containers[] · initContainers[] — all Pod-bearing kinds',
    what: 'requests talks to the scheduler — "I need at least 500m CPU to start." limits talks to the Linux kernel — the container\'s cgroup is capped. Exceed memory limit: OOM kill. Exceed CPU limit: throttled, not killed.',
    yaml: `resources:
  requests:
    cpu: "500m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"`,
    trap: 'Setting limits without requests. K8s defaults requests to equal limits. A container needing 100m CPU but with a limit of 2000m blocks 2000m of schedulable capacity on the node.',
  },
  {
    key: 'securityContext',
    short: 'Two levels: Pod and container',
    appearsIn: 'spec · containers[] — all Pod-bearing kinds',
    what: 'Pod-level sets: runAsUser, runAsGroup, fsGroup, sysctls. Container-level sets: runAsUser (overrides pod-level), allowPrivilegeEscalation, capabilities, readOnlyRootFilesystem.',
    yaml: `spec:
  securityContext:        # pod level
    runAsUser: 1000
    fsGroup: 2000
  containers:
    - securityContext:    # container level
        runAsUser: 2000
        allowPrivilegeEscalation: false`,
    trap: 'fsGroup only exists at pod level — it sets group ownership of mounted volumes. People look for it at container level and do not find it.',
  },
  {
    key: 'initContainers',
    short: 'Run sequentially before main containers',
    appearsIn: 'spec — all Pod-bearing kinds',
    what: 'Init containers run one by one, in order. Each must exit 0 before the next starts. Main containers do not start until all succeed. Since 1.29: a container with restartPolicy: Always inside initContainers is a native sidecar — starts before main containers and stays running.',
    yaml: `initContainers:
  - name: wait-for-db
    image: busybox
    command: ['sh', '-c', 'until nc -z db 5432; do sleep 2; done']`,
    trap: 'Before 1.29, people faked sidecars by running a never-exiting process as an init container — which blocked the entire init chain indefinitely.',
  },
  {
    key: 'terminationGracePeriodSeconds',
    short: 'Time between SIGTERM and SIGKILL',
    appearsIn: 'spec — all Pod-bearing kinds',
    what: 'On delete: (1) preStop hook fires, (2) SIGTERM sent to PID 1, (3) grace period countdown starts (default 30s), (4) timer hits 0 → SIGKILL. preStop and SIGTERM run concurrently inside the grace period.',
    yaml: `spec:
  terminationGracePeriodSeconds: 60
  containers:
    - lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]`,
    trap: 'preStop takes 25s, app needs 10s more to drain connections — you need 60s total, not 30. The default 30s is often too short for database connections.',
  },
];

export const MULTI_KINDS: NodeKind[] = [
  'Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job',
  'Service', 'Ingress', 'HTTPRoute', 'TCPRoute', 'RoleBinding', 'Pod',
];

/** Per-kind direction hints shown under the Outgoing / Incoming toggle. */
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

/** Natural YAML section order — targets are sorted by this to prevent bezier crossings. */
/** Maps a source field to the side where its target card appears in the radial hub layout. */
const SIDE_BY_FIELD: Partial<Record<SourceField, 'top' | 'right' | 'bottom' | 'left'>> = {
  [SourceField.ServiceAccountName]: 'right',
  [SourceField.Selector]:           'right',
  [SourceField.ScaleTargetRef]:     'right',
  [SourceField.BackendRefs]:        'right',
  [SourceField.IngressBackend]:     'right',
  [SourceField.IngressTLS]:         'top',
  [SourceField.EnvFromConfigMap]:   'top',
  [SourceField.EnvConfigMapKey]:    'top',
  [SourceField.VolumeConfigMap]:    'top',
  [SourceField.ProjectedConfigMap]: 'top',
  [SourceField.ParentRefs]:         'top',
  [SourceField.RoleRef]:            'top',
  [SourceField.EnvFromSecret]:      'bottom',
  [SourceField.EnvSecretKey]:       'bottom',
  [SourceField.VolumeSecret]:       'bottom',
  [SourceField.ProjectedSecret]:    'bottom',
  [SourceField.Subjects]:           'bottom',
  [SourceField.VolumePVC]:          'left',
  [SourceField.OwnerReference]:     'left',
};

/** A target card in the radial hub layout (pre-computed absolute position). */
export interface RadialCardView {
  targetNode:  GraphNode;
  targetLines: YamlLine[];
  edge:        GraphEdge;
  x:     number;
  y:     number;
  cardH: number;
  side:  'top' | 'right' | 'bottom' | 'left';
}

export interface RadialLayoutView {
  srcNode:  GraphNode;
  srcLines: YamlLine[];
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  cards:   RadialCardView[];
  paths:   Array<{ d: string; edgeType: EdgeType }>;
  canvasW: number;
  canvasH: number;
}

const FIELD_SECTION_ORDER: SourceField[] = [
  SourceField.Selector,
  SourceField.ServiceAccountName,
  SourceField.EnvFromConfigMap, SourceField.EnvFromSecret,
  SourceField.EnvConfigMapKey, SourceField.EnvSecretKey,
  SourceField.VolumePVC, SourceField.VolumeConfigMap, SourceField.VolumeSecret,
  SourceField.ProjectedConfigMap, SourceField.ProjectedSecret,
  SourceField.ParentRefs, SourceField.BackendRefs,
  SourceField.RoleRef, SourceField.Subjects,
];

/** Static fallback data for Snapshot Resources view — used when no cluster data is available. */
const STATIC_MULTI_EXAMPLES: Partial<Record<NodeKind, Array<{ field: SourceField; tgtKind: NodeKind; tgtName: string }>>> = {
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

function buildStaticMultiExample(kind: NodeKind): MultiExampleView | null {
  const defs = STATIC_MULTI_EXAMPLES[kind];
  if (!defs) return null;

  const srcNameMap: Partial<Record<NodeKind, string>> = {
    RoleBinding: 'my-binding', HTTPRoute: 'my-route', TCPRoute: 'my-route',
  };
  const srcName = srcNameMap[kind] ?? 'my-app';
  const srcNode: GraphNode = {
    id: `static/${kind}/${srcName}`, name: srcName, kind,
    category: 'workload', namespace: 'default', metadata: {},
  };

  const sorted = [...defs].sort((a, b) => {
    const ia = FIELD_SECTION_ORDER.indexOf(a.field);
    const ib = FIELD_SECTION_ORDER.indexOf(b.field);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const targets = sorted.map(def => {
    const tgtNode: GraphNode = {
      id: `static/${def.tgtKind}/${def.tgtName}`, name: def.tgtName, kind: def.tgtKind,
      category: 'abstract', namespace: 'default', metadata: {},
    };
    const edge: GraphEdge = {
      source: srcNode.id, target: tgtNode.id,
      type: FIELD_GLOSSARY[def.field].edgeType, sourceField: def.field,
    };
    const { targetLines } = buildSnippet(def.field, srcNode, tgtNode);
    return { targetNode: tgtNode, edge, targetLines };
  });

  const combinedLines = buildCombinedSnippet(
    srcNode,
    sorted.map(def => ({
      field: def.field,
      targetNode: { id: `static/${def.tgtKind}/${def.tgtName}`, name: def.tgtName, kind: def.tgtKind, category: 'abstract' as const, namespace: 'default', metadata: {} },
    })),
  );

  return { sourceNode: srcNode, combinedLines, targets };
}

/**
 * Build a single combined YAML snippet for a source node, showing all
 * referenced fields. Highlighted lines appear in FIELD_SECTION_ORDER
 * so they match the top-to-bottom order of the target cards.
 */
function buildCombinedSnippet(
  src: GraphNode,
  fieldTargets: Array<{ field: SourceField; targetNode: GraphNode }>,
): YamlLine[] {
  const s = (text: string, highlight = false): YamlLine => ({ text, highlight });

  // Group names by field — same field can appear multiple times
  const fieldNames = new Map<SourceField, string[]>();
  for (const { field, targetNode } of fieldTargets) {
    if (!fieldNames.has(field)) fieldNames.set(field, []);
    fieldNames.get(field)!.push(targetNode.name);
  }
  const has   = (f: SourceField) => fieldNames.has(f);
  const names = (f: SourceField) => fieldNames.get(f) ?? [];

  const lines: YamlLine[] = [];
  lines.push(s(`# ${src.kind}`));

  // ── Workload (Deployment / StatefulSet / DaemonSet / CronJob) ──
  if (['Deployment','StatefulSet','DaemonSet','CronJob'].includes(src.kind)) {
    lines.push(s('spec:'), s('  template:'), s('    spec:'));

    if (has(SourceField.ServiceAccountName)) {
      lines.push(s(`      serviceAccountName: ${names(SourceField.ServiceAccountName)[0]}`, true));
    }

    const hasContainerRef = [
      SourceField.EnvFromConfigMap, SourceField.EnvFromSecret,
      SourceField.EnvConfigMapKey, SourceField.EnvSecretKey,
    ].some(has);
    if (hasContainerRef) {
      lines.push(s('      containers:'), s('        - ...'));
      if (has(SourceField.EnvFromConfigMap) || has(SourceField.EnvFromSecret)) {
        lines.push(s('          envFrom:'));
        for (const name of names(SourceField.EnvFromConfigMap)) {
          lines.push(s('            - configMapRef:'));
          lines.push(s(`                name: ${name}`, true));
        }
        for (const name of names(SourceField.EnvFromSecret)) {
          lines.push(s('            - secretRef:'));
          lines.push(s(`                name: ${name}`, true));
        }
      }
      if (has(SourceField.EnvConfigMapKey) || has(SourceField.EnvSecretKey)) {
        lines.push(s('          env:'));
        for (const name of names(SourceField.EnvConfigMapKey)) {
          lines.push(s('            - valueFrom:'), s('                configMapKeyRef:'));
          lines.push(s(`                  name: ${name}`, true));
        }
        for (const name of names(SourceField.EnvSecretKey)) {
          lines.push(s('            - valueFrom:'), s('                secretKeyRef:'));
          lines.push(s(`                  name: ${name}`, true));
        }
      }
    }

    const hasVolumeRef = [
      SourceField.VolumePVC, SourceField.VolumeConfigMap, SourceField.VolumeSecret,
      SourceField.ProjectedConfigMap, SourceField.ProjectedSecret,
    ].some(has);
    if (hasVolumeRef) {
      lines.push(s('      volumes:'));
      for (const name of names(SourceField.VolumePVC)) {
        lines.push(s('        - persistentVolumeClaim:'));
        lines.push(s(`            claimName: ${name}`, true));
      }
      for (const name of names(SourceField.VolumeConfigMap)) {
        lines.push(s('        - configMap:'));
        lines.push(s(`            name: ${name}`, true));
      }
      for (const name of names(SourceField.VolumeSecret)) {
        lines.push(s('        - secret:'));
        lines.push(s(`            secretName: ${name}`, true));
      }
      for (const name of names(SourceField.ProjectedConfigMap)) {
        lines.push(s('        - projected:'), s('            sources:'), s('              - configMap:'));
        lines.push(s(`                  name: ${name}`, true));
      }
      for (const name of names(SourceField.ProjectedSecret)) {
        lines.push(s('        - projected:'), s('            sources:'), s('              - secret:'));
        lines.push(s(`                  name: ${name}`, true));
      }
    }
  }

  // ── Ingress ──
  if (src.kind === 'Ingress') {
    lines.push(s('spec:'));
    for (const name of names(SourceField.IngressTLS)) {
      lines.push(s('  tls:'), s('    - hosts: [...]'));
      lines.push(s(`      secretName: ${name}`, true));
    }
    for (const name of names(SourceField.IngressBackend)) {
      lines.push(s('  rules:'), s('    - http:'), s('        paths:'), s('          - backend:'), s('              service:'));
      lines.push(s(`                name: ${name}`, true));
    }
  }

  // ── HTTPRoute / TCPRoute ──
  if (src.kind === 'HTTPRoute' || src.kind === 'TCPRoute') {
    lines.push(s('spec:'));
    for (const name of names(SourceField.ParentRefs)) {
      lines.push(s('  parentRefs:'));
      lines.push(s(`    - name: ${name}`, true));
    }
    for (const name of names(SourceField.BackendRefs)) {
      lines.push(s('  rules:'), s('    - backendRefs:'));
      lines.push(s(`        - name: ${name}`, true));
    }
  }

  // ── Service ──
  if (src.kind === 'Service') {
    lines.push(s('spec:'), s('  selector:'));
    for (const name of names(SourceField.Selector)) {
      lines.push(s(`    app: ${name}`, true));
    }
  }

  // ── RoleBinding ──
  if (src.kind === 'RoleBinding') {
    for (const name of names(SourceField.RoleRef)) {
      lines.push(s('roleRef:'), s('  apiGroup: rbac.authorization.k8s.io'));
      lines.push(s(`  name: ${name}`, true));
    }
    for (const name of names(SourceField.Subjects)) {
      lines.push(s('subjects:'), s('  - kind: ServiceAccount'));
      lines.push(s(`    name: ${name}`, true));
    }
  }

  return lines;
}

export interface BipartiteCard {
  node:  GraphNode;
  lines: YamlLine[];
  x:     number;
  y:     number;
}

export interface BipartiteView {
  sources: BipartiteCard[];
  targets: BipartiteCard[];
  paths:   Array<{ d: string; edgeType: EdgeType }>;
  svgH:    number;
  svgW:    number;
  cardW:   number;
}

function buildBipartiteView(
  srcNodes: GraphNode[],
  allEdges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
): BipartiteView {
  const lineH    = 20;
  const headerH  = 42;
  const cardPad  = 8;
  const cardGap  = 24;
  const cardW    = 300;
  const srcX     = 0;
  const gapW     = 80;
  const tgt0X    = cardW + gapW;
  const tgt1X    = tgt0X + cardW + 20;
  const numCols  = 1;

  // Build each source with sorted targets
  type SrcEntry = { node: GraphNode; combinedLines: YamlLine[]; targets: Array<{ tgtId: string; edge: GraphEdge }> };
  const sources: SrcEntry[] = srcNodes.map(srcNode => {
    const rawTargets = allEdges
      .filter(e => e.source === srcNode.id && e.sourceField && nodeMap.has(e.target))
      .map(e => ({ tgtId: e.target, edge: e }));
    const sorted = [...rawTargets].sort((a, b) => {
      const ia = FIELD_SECTION_ORDER.indexOf(a.edge.sourceField!);
      const ib = FIELD_SECTION_ORDER.indexOf(b.edge.sourceField!);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    const combinedLines = sorted.length
      ? buildCombinedSnippet(srcNode, sorted.map(t => ({ field: t.edge.sourceField!, targetNode: nodeMap.get(t.tgtId)! })))
      : [{ text: `# ${srcNode.kind}`, highlight: false }, { text: `  name: ${srcNode.name}`, highlight: false }];
    return { node: srcNode, combinedLines, targets: sorted };
  });

  // Deduplicate targets (first-seen order)
  const seenIds = new Set<string>();
  const targets: Array<{ node: GraphNode; lines: YamlLine[]; id: string }> = [];
  for (const src of sources) {
    for (const { tgtId, edge } of src.targets) {
      if (!seenIds.has(tgtId)) {
        seenIds.add(tgtId);
        const tgtNode = nodeMap.get(tgtId)!;
        const { targetLines } = buildSnippet(edge.sourceField!, src.node, tgtNode);
        targets.push({ node: tgtNode, lines: targetLines, id: tgtId });
      }
    }
  }

  // Source positions — left column
  const srcCards: BipartiteCard[] = [];
  let sy = 0;
  for (const src of sources) {
    srcCards.push({ node: src.node, lines: src.combinedLines, x: srcX, y: sy });
    sy += headerH + cardPad * 2 + src.combinedLines.length * lineH + cardGap;
  }

  // Target positions — 2-column grid
  const rowHeights: number[] = [];
  for (let i = 0; i < targets.length; i++) {
    const row = Math.floor(i / numCols);
    const h = headerH + cardPad * 2 + targets[i].lines.length * lineH;
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
  }
  const rowStartYs: number[] = [];
  let ry = 0;
  for (const rh of rowHeights) { rowStartYs.push(ry); ry += rh + cardGap; }

  const tgtCards: BipartiteCard[] = targets.map((tgt, i) => {
    const col = i % numCols;
    const row = Math.floor(i / numCols);
    return { node: tgt.node, lines: tgt.lines, x: col === 0 ? tgt0X : tgt1X, y: rowStartYs[row] };
  });

  // Bezier paths
  const paths: Array<{ d: string; edgeType: EdgeType }> = [];
  for (let si = 0; si < sources.length; si++) {
    const src      = sources[si];
    const srcCard  = srcCards[si];
    const hlIndices = src.combinedLines.map((l, i) => l.highlight ? i : -1).filter(i => i >= 0);
    for (let ti = 0; ti < src.targets.length; ti++) {
      const { tgtId, edge } = src.targets[ti];
      const tgtIdx  = targets.findIndex(t => t.id === tgtId);
      if (tgtIdx === -1) continue;
      const tgtCard = tgtCards[tgtIdx];
      const tgt     = targets[tgtIdx];
      const hlIdx   = hlIndices[ti] ?? (src.combinedLines.length - 1);
      const y1 = srcCard.y + headerH + cardPad + hlIdx * lineH + lineH / 2;
      const tgtHlIdx = tgt.lines.findIndex(l => l.highlight);
      const y2 = tgtCard.y + headerH + cardPad + (tgtHlIdx >= 0 ? tgtHlIdx : 0) * lineH + lineH / 2;
      const x1 = cardW, x2 = tgtCard.x;
      const cx1 = x1 + (x2 - x1) * 0.4, cx2 = x1 + (x2 - x1) * 0.6;
      paths.push({ d: `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`, edgeType: edge.type });
    }
  }

  const svgH = Math.max(sy, ry);
  const svgW = tgt1X + cardW;
  return { sources: srcCards, targets: tgtCards, paths, svgH, svgW, cardW };
}

/**
 * Reverse bipartite view: finds nodes that have edges pointing TO tgtNodes.
 * Left = referencing nodes, Right = selected kind nodes (the targets).
 */
function buildReverseBipartiteView(
  tgtNodes: GraphNode[],
  allEdges: GraphEdge[],
  nodeMap:  Map<string, GraphNode>,
): BipartiteView {
  const lineH   = 20;
  const headerH = 42;
  const cardPad = 8;
  const cardGap = 24;
  const cardW   = 300;
  const srcX    = 0;
  const gapW    = 80;
  const tgt0X   = cardW + gapW;
  const tgt1X   = tgt0X + cardW + 20;
  const numCols = 1;

  const tgtIdSet = new Set(tgtNodes.map(n => n.id));

  // Group incoming edges by source node
  type SrcEntry = { node: GraphNode; targets: Array<{ tgtId: string; edge: GraphEdge }> };
  const srcMap = new Map<string, SrcEntry>();
  for (const e of allEdges) {
    if (!tgtIdSet.has(e.target) || !e.sourceField || !nodeMap.has(e.source)) continue;
    if (!srcMap.has(e.source)) srcMap.set(e.source, { node: nodeMap.get(e.source)!, targets: [] });
    srcMap.get(e.source)!.targets.push({ tgtId: e.target, edge: e });
  }

  const sources = Array.from(srcMap.values());
  if (!sources.length) return { sources: [], targets: [], paths: [], svgH: 0, svgW: 0, cardW };

  // Source cards (LEFT) — referencing nodes with snippet showing the field they use
  const srcCards: BipartiteCard[] = [];
  let sy = 0;
  for (const src of sources) {
    const sorted = [...src.targets].sort((a, b) => {
      const ia = FIELD_SECTION_ORDER.indexOf(a.edge.sourceField!);
      const ib = FIELD_SECTION_ORDER.indexOf(b.edge.sourceField!);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    const combinedLines = buildCombinedSnippet(
      src.node,
      sorted.map(t => ({ field: t.edge.sourceField!, targetNode: nodeMap.get(t.tgtId)! })),
    );
    srcCards.push({ node: src.node, lines: combinedLines, x: srcX, y: sy });
    sy += headerH + cardPad * 2 + combinedLines.length * lineH + cardGap;
  }

  // Target cards (RIGHT) — selected kind nodes (first-seen order, deduplicated)
  const seenIds = new Set<string>();
  const tgtEntries: Array<{ node: GraphNode; lines: YamlLine[]; id: string }> = [];
  for (const src of sources) {
    for (const { tgtId, edge } of src.targets) {
      if (!seenIds.has(tgtId)) {
        seenIds.add(tgtId);
        const tgtNode = nodeMap.get(tgtId)!;
        const { targetLines } = buildSnippet(edge.sourceField!, src.node, tgtNode);
        tgtEntries.push({ node: tgtNode, lines: targetLines, id: tgtId });
      }
    }
  }

  // Target positions — 2-column grid
  const rowHeights: number[] = [];
  for (let i = 0; i < tgtEntries.length; i++) {
    const row = Math.floor(i / numCols);
    const h = headerH + cardPad * 2 + tgtEntries[i].lines.length * lineH;
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
  }
  const rowStartYs: number[] = [];
  let ry = 0;
  for (const rh of rowHeights) { rowStartYs.push(ry); ry += rh + cardGap; }

  const tgtCards: BipartiteCard[] = tgtEntries.map((tgt, i) => {
    const col = i % numCols;
    const row = Math.floor(i / numCols);
    return { node: tgt.node, lines: tgt.lines, x: col === 0 ? tgt0X : tgt1X, y: rowStartYs[row] };
  });

  // Bezier paths
  const paths: Array<{ d: string; edgeType: EdgeType }> = [];
  for (let si = 0; si < sources.length; si++) {
    const src       = sources[si];
    const srcCard   = srcCards[si];
    const hlIndices = srcCard.lines.map((l, i) => l.highlight ? i : -1).filter(i => i >= 0);
    for (let ti = 0; ti < src.targets.length; ti++) {
      const { tgtId, edge } = src.targets[ti];
      const tgtIdx  = tgtEntries.findIndex(t => t.id === tgtId);
      if (tgtIdx === -1) continue;
      const tgtCard  = tgtCards[tgtIdx];
      const tgt      = tgtEntries[tgtIdx];
      const hlIdx    = hlIndices[ti] ?? (srcCard.lines.length - 1);
      const y1       = srcCard.y + headerH + cardPad + hlIdx * lineH + lineH / 2;
      const tgtHlIdx = tgt.lines.findIndex(l => l.highlight);
      const y2       = tgtCard.y + headerH + cardPad + (tgtHlIdx >= 0 ? tgtHlIdx : 0) * lineH + lineH / 2;
      const x1 = cardW, x2 = tgtCard.x;
      const cx1 = x1 + (x2 - x1) * 0.4, cx2 = x1 + (x2 - x1) * 0.6;
      paths.push({ d: `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`, edgeType: edge.type });
    }
  }

  const svgH = Math.max(sy, ry);
  const svgW = tgt1X + cardW;
  return { sources: srcCards, targets: tgtCards, paths, svgH, svgW, cardW };
}

/**
 * Radial hub layout for single-source view.
 * Places targets in 4 directions around the source based on field semantics:
 *   top    = ConfigMaps, RoleRef, ParentRefs
 *   bottom = Secrets, Subjects
 *   right  = ServiceAccount, Selector, Routes
 *   left   = PVC, OwnerReference
 */
function buildRadialLayout(mx: MultiExampleView): RadialLayoutView | null {
  if (!mx.targets.length || mx.emptyMsg) return null;

  const lineH   = 20;
  const headerH = 42;
  const cardPad = 8;
  const cardW   = 300;
  const sideGap = 100;
  const cardGap = 16;
  const pad     = 40;

  const getH = (lines: YamlLine[]) => headerH + cardPad * 2 + lines.length * lineH;
  const srcLines = mx.combinedLines;
  const srcH     = getH(srcLines);
  const srcW     = cardW;

  // Assign each target to a side
  const assignments = mx.targets.map(t =>
    (t.edge.sourceField ? SIDE_BY_FIELD[t.edge.sourceField] : undefined) ?? 'right' as const,
  );

  // Group indices by side
  const idxBySide: Record<string, number[]> = { right: [], bottom: [], left: [], top: [] };
  for (let i = 0; i < assignments.length; i++) idxBySide[assignments[i]].push(i);

  // Rebalance: if left empty and right >3, split the right half to left
  if (!idxBySide['left'].length && idxBySide['right'].length > 3) {
    idxBySide['left'].push(...idxBySide['right'].splice(-Math.floor(idxBySide['right'].length / 2)));
  }

  // Helpers: total stacked height for a group; total horizontal width for a row
  const stackH = (idxs: number[]) =>
    idxs.reduce((s, i, j) => s + getH(mx.targets[i].targetLines) + (j > 0 ? cardGap : 0), 0);
  const rowW   = (idxs: number[]) =>
    idxs.length * (cardW + cardGap) - (idxs.length > 0 ? cardGap : 0);
  const maxH   = (idxs: number[]) =>
    idxs.reduce((m, i) => Math.max(m, getH(mx.targets[i].targetLines)), 0);

  const rightH   = stackH(idxBySide['right']);
  const leftH    = stackH(idxBySide['left']);
  const topMaxH  = maxH(idxBySide['top']);
  const botMaxH  = maxH(idxBySide['bottom']);
  const topW     = rowW(idxBySide['top']);
  const botW     = rowW(idxBySide['bottom']);

  // Source top-left position
  const leftExtent = idxBySide['left'].length  > 0 ? cardW + sideGap : 0;
  const topExtent  = idxBySide['top'].length   > 0 ? topMaxH + sideGap : 0;
  const maxVert    = Math.max(rightH, leftH, srcH);
  const srcX = Math.max(pad + leftExtent, pad + Math.max(0, (topW - srcW) / 2), pad + Math.max(0, (botW - srcW) / 2));
  const srcY = pad + topExtent + Math.max(0, (maxVert - srcH) / 2);

  // Highlight indices in source YAML — computed here so card placement can use them
  const srcHlIndices = srcLines.map((l, i) => l.highlight ? i : -1).filter(i => i >= 0);

  // Place target cards (cards[] is parallel to mx.targets)
  const cards: RadialCardView[] = new Array(mx.targets.length);

  // RIGHT / LEFT: align each card's highlight line to the corresponding source highlight line,
  // then clamp downward to avoid overlap with the previous card.
  let prevRightBottom = -Infinity;
  for (const i of idxBySide['right']) {
    const h = getH(mx.targets[i].targetLines);
    const srcHlIdx  = srcHlIndices[i] ?? srcHlIndices[0] ?? 0;
    const srcHlY    = srcY + headerH + cardPad + srcHlIdx * lineH + lineH / 2;
    const tgtHlIdx  = mx.targets[i].targetLines.findIndex(l => l.highlight);
    const tgtHlOff  = headerH + cardPad + (tgtHlIdx >= 0 ? tgtHlIdx : 0) * lineH + lineH / 2;
    const y = Math.max(srcHlY - tgtHlOff, prevRightBottom + cardGap);
    cards[i] = { ...mx.targets[i], x: srcX + srcW + sideGap, y, cardH: h, side: 'right' };
    prevRightBottom = y + h;
  }

  let prevLeftBottom = -Infinity;
  for (const i of idxBySide['left']) {
    const h = getH(mx.targets[i].targetLines);
    const srcHlIdx  = srcHlIndices[i] ?? srcHlIndices[0] ?? 0;
    const srcHlY    = srcY + headerH + cardPad + srcHlIdx * lineH + lineH / 2;
    const tgtHlIdx  = mx.targets[i].targetLines.findIndex(l => l.highlight);
    const tgtHlOff  = headerH + cardPad + (tgtHlIdx >= 0 ? tgtHlIdx : 0) * lineH + lineH / 2;
    const y = Math.max(srcHlY - tgtHlOff, prevLeftBottom + cardGap);
    cards[i] = { ...mx.targets[i], x: srcX - sideGap - cardW, y, cardH: h, side: 'left' };
    prevLeftBottom = y + h;
  }

  let tx = srcX + srcW / 2 - topW / 2;
  for (const i of idxBySide['top']) {
    const h = getH(mx.targets[i].targetLines);
    cards[i] = { ...mx.targets[i], x: tx, y: srcY - sideGap - h, cardH: h, side: 'top' };
    tx += cardW + cardGap;
  }

  let bx = srcX + srcW / 2 - botW / 2;
  for (const i of idxBySide['bottom']) {
    const h = getH(mx.targets[i].targetLines);
    cards[i] = { ...mx.targets[i], x: bx, y: srcY + srcH + sideGap, cardH: h, side: 'bottom' };
    bx += cardW + cardGap;
  }

  // Canvas dimensions
  const canvasW = Math.max(
    srcX + srcW + (idxBySide['right'].length > 0 ? sideGap + cardW : 0) + pad,
    srcX + srcW / 2 + topW / 2 + pad,
    srcX + srcW / 2 + botW / 2 + pad,
  );
  const canvasH = Math.max(
    srcY + (maxVert - srcH) / 2 + maxVert + (idxBySide['bottom'].length > 0 ? sideGap + botMaxH : 0) + pad,
    pad + topExtent + maxVert + pad,
  );

  // Bezier paths
  const paths: Array<{ d: string; edgeType: EdgeType }> = [];

  for (let i = 0; i < mx.targets.length; i++) {
    const card = cards[i];
    if (!card) continue;

    const srcHlIdx = srcHlIndices[i] ?? srcHlIndices[srcHlIndices.length - 1] ?? 0;
    const srcHlY   = srcY + headerH + cardPad + srcHlIdx * lineH + lineH / 2;
    const tgtHlIdx = card.targetLines.findIndex(l => l.highlight);
    const tgtHL    = tgtHlIdx >= 0 ? tgtHlIdx : 0;

    let d = '';
    switch (card.side) {
      case 'right': {
        const x1 = srcX + srcW, y1 = srcHlY;
        const x2 = card.x,      y2 = card.y + headerH + cardPad + tgtHL * lineH + lineH / 2;
        const cx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
        break;
      }
      case 'left': {
        const x1 = srcX,           y1 = srcHlY;
        const x2 = card.x + cardW, y2 = card.y + headerH + cardPad + tgtHL * lineH + lineH / 2;
        const cx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
        break;
      }
      case 'top': {
        const x1 = srcX + srcW / 2,      y1 = srcY;
        const x2 = card.x + cardW / 2,   y2 = card.y + card.cardH;
        const cy = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
        break;
      }
      case 'bottom': {
        const x1 = srcX + srcW / 2,    y1 = srcY + srcH;
        const x2 = card.x + cardW / 2, y2 = card.y;
        const cy = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
        break;
      }
    }
    paths.push({ d, edgeType: card.edge.type });
  }

  return { srcNode: mx.sourceNode, srcLines, srcX, srcY, srcW, srcH, cards, paths, canvasW, canvasH };
}

// ── Component ──────────────────────────────────────────────────────────────

export interface ExampleView {
  sourceNode: GraphNode;
  targetNode: GraphNode;
  edge: GraphEdge;
  sourceLines: YamlLine[];
  targetLines: YamlLine[];
}

// ── CRD Pattern (static, no cluster data) ─────────────────────────────────

export enum CrdField {
  CRDSchema       = 'crd.schema',
  CRInstance      = 'cr.instance',
  ControllerRBAC  = 'controller.rbac',
}

export interface CrdInfo {
  short: string;
  notes: string;
  usage: string[];
  edgeLabel: string;
  sourceKind: string;
  targetKind: string;
  sourceLines: YamlLine[];
  targetLines: YamlLine[];
}

const s = (text: string, highlight = false): YamlLine => ({ text, highlight });

export const CRD_GLOSSARY: Record<CrdField, CrdInfo> = {
  [CrdField.CRDSchema]: {
    short: 'CRD registers a new kind',
    edgeLabel: 'defines',
    sourceKind: 'CustomResourceDefinition',
    targetKind: 'CustomResource (instance)',
    notes: 'A CRD teaches K8s a new word. spec.group + spec.names.kind together become the CR\'s apiVersion (group/version) and kind. Nothing happens when you apply a CRD — K8s stores it and validates future instances against the schema. A controller must be running to act on them.',
    usage: [
      'kubectl apply -f crd.yaml        # register the new kind',
      'kubectl get crds                  # verify it exists',
      'kubectl explain helloworld.spec   # K8s now knows the schema',
    ],
    sourceLines: [
      s('# CustomResourceDefinition'),
      s('spec:'),
      s('  group: demo.example.com', true),
      s('  names:'),
      s('    kind: HelloWorld'),
      s('    plural: helloworlds'),
      s('  scope: Namespaced'),
      s('  versions:'),
      s('    - name: v1'),
      s('      served: true'),
      s('      storage: true'),
    ],
    targetLines: [
      s('# HelloWorld (Custom Resource)'),
      s('apiVersion: demo.example.com/v1', true),
      s('kind: HelloWorld'),
      s('metadata:'),
      s('  name: my-greeter'),
      s('spec:'),
      s('  message: "hey from mammoth!"'),
      s('  intervalSeconds: 10'),
    ],
  },

  [CrdField.CRInstance]: {
    short: 'CR is an instance of its CRD kind',
    edgeLabel: 'instance-of',
    sourceKind: 'CustomResource (CR)',
    targetKind: 'CustomResourceDefinition',
    notes: 'Creating a CR is like calling a constructor. K8s validates the spec against the CRD openAPIV3Schema on admission. The CR is just stored data — it does nothing on its own. The controller watches for CRs of this kind and reconciles them toward the desired state.',
    usage: [
      'kubectl apply -f cr.yaml          # create an instance',
      'kubectl get helloworlds           # list all instances',
      'kubectl describe helloworld my-greeter',
    ],
    sourceLines: [
      s('# HelloWorld (Custom Resource)'),
      s('apiVersion: demo.example.com/v1'),
      s('kind: HelloWorld', true),
      s('metadata:'),
      s('  name: my-greeter'),
      s('spec:'),
      s('  message: "hey from mammoth!"'),
      s('  intervalSeconds: 10'),
    ],
    targetLines: [
      s('# CustomResourceDefinition'),
      s('spec:'),
      s('  group: demo.example.com'),
      s('  names:'),
      s('    kind: HelloWorld', true),
      s('    plural: helloworlds'),
      s('  scope: Namespaced'),
    ],
  },

  [CrdField.ControllerRBAC]: {
    short: 'Controller ClusterRole grants access to CRD group',
    edgeLabel: 'governs',
    sourceKind: 'ClusterRole (controller)',
    targetKind: 'CustomResourceDefinition',
    notes: 'The controller must explicitly list the CRD\'s apiGroup to get RBAC permission. The /status subresource requires a separate rule — read access to the main resource does not imply status write. Use ClusterRole (not Role) if CRs span namespaces.',
    usage: [
      '// controller-runtime (Go):',
      'mgr.GetClient().List(ctx, &hwList)     // needs get, list, watch',
      'client.Status().Patch(ctx, hw, patch)  // needs helloworlds/status',
    ],
    sourceLines: [
      s('# ClusterRole'),
      s('rules:'),
      s('  - apiGroups:'),
      s('      - demo.example.com', true),
      s('    resources: [helloworlds]'),
      s('    verbs: [get, list, watch]'),
      s('  - apiGroups:'),
      s('      - demo.example.com'),
      s('    resources: [helloworlds/status]'),
      s('    verbs: [patch, update]'),
    ],
    targetLines: [
      s('# CustomResourceDefinition'),
      s('spec:'),
      s('  group: demo.example.com', true),
      s('  names:'),
      s('    kind: HelloWorld'),
    ],
  },
};

@Component({
  selector: 'app-knowledge',
  imports: [BackLinkComponent, ThemeSwitcherComponent, NamespaceChipsComponent, NetworkPatternsComponent],
  templateUrl: './knowledge.component.html',
  styleUrls: ['./knowledge.component.scss'],
})
export class KnowledgeComponent implements OnInit, AfterViewChecked {
  protected readonly graphData  = inject(GraphDataService);
  private readonly router       = inject(Router);
  protected readonly dataModeService = inject(DataModeService);
  private readonly themeService = inject(ThemeService);

  @ViewChild('sourceHighlight') sourceHighlightRef?: ElementRef<HTMLElement>;
  @ViewChild('targetHighlight') targetHighlightRef?: ElementRef<HTMLElement>;
  @ViewChild('cardsContainer')  cardsContainerRef?: ElementRef<HTMLElement>;

  @ViewChildren('rowSrcHL') rowSrcHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('rowTgtHL') rowTgtHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('multiContainer') multiContainerRef?: ElementRef<HTMLElement>;

  @ViewChildren('radialSrcHL') radialSrcHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('radialTgtHL') radialTgtHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('radialContainer') radialContainerRef?: ElementRef<HTMLElement>;
  readonly radialPaths = signal<Array<{ d: string; edgeType: EdgeType }>>([]);

  @ViewChildren('podLeftHL')  podLeftHighlights!:  QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('podRightHL') podRightHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('podRowsContainer') podRowsContainerRef?: ElementRef<HTMLElement>;
  readonly podRowPaths = signal<Array<{ d: string; edgeType: EdgeType }>>([]);

  readonly loading = this.graphData.loading;
  readonly error   = this.graphData.error;

  readonly fieldGlossary  = FIELD_GLOSSARY;
  readonly crdGlossary    = CRD_GLOSSARY;
  readonly sidebarFields: SourceField[] = [
    SourceField.Selector,
    SourceField.ServiceAccountName,
    SourceField.EnvFromConfigMap, SourceField.EnvFromSecret,
    SourceField.EnvConfigMapKey,  SourceField.EnvSecretKey,
    SourceField.VolumePVC, SourceField.VolumeConfigMap, SourceField.VolumeSecret,
    SourceField.ProjectedConfigMap, SourceField.ProjectedSecret,
    SourceField.ParentRefs, SourceField.BackendRefs,
    SourceField.IngressBackend, SourceField.IngressTLS,
    SourceField.ScaleTargetRef,
    SourceField.RoleRef, SourceField.Subjects,
    SourceField.OwnerReference,
  ];
  readonly crdFields      = Object.values(CrdField);
  readonly selectedFieldGlossary = signal<SourceField | null>(null);
  readonly selectedCrdField = signal<CrdField | null>(null);
  readonly connectorPath  = signal<string>('');
  readonly connectorH     = signal<number>(200);
  readonly connectorW     = signal<number>(80);

  readonly edgeColors    = signal<Record<EdgeType, string>>(getThemedEdgeColors());
  readonly ownsEdgeType  = EdgeType.Owns;

  readonly connectorMid = signal<{ x: number; y: number } | null>(null);

  readonly dragOffset  = signal({ x: 0, y: 0 });
  readonly scale       = signal(1);
  readonly isDragging  = signal(false);
  private  dragStart   = { x: 0, y: 0 };

  @ViewChild('mainArea') mainAreaRef?: ElementRef<HTMLElement>;

  readonly selectedGraphKind     = signal<NodeKind | null>(null);
  readonly selectedNamespace     = signal<string | null>(null);
  readonly selectedNetworkType   = signal<NetworkType | null>(null);
  readonly networkSections: { label: string; types: NetworkType[] }[] = [
    { label: 'SERVICE TYPE', types: ['ClusterIP', 'NodePort', 'LoadBalancer'] },
    { label: 'TOPOLOGY',     types: ['NodeNamespace', 'WorkloadTypes'] },
    { label: 'ROUTING',      types: ['Ingress', 'Gateway'] },
    { label: 'PROXY MODE',   types: ['ProxyMode'] },
    { label: 'CLUSTER',      types: ['MasterWorker', 'PodLifecycle', 'ScenarioDeploy', 'ScenarioCrash', 'ScenarioTraffic'] },
    { label: 'INTERFACES',   types: ['Interfaces'] },
  ];
  readonly multiPaths    = signal<string[]>([]);
  readonly multiSvgH     = signal<number>(400);
  readonly multiSvgW     = signal<number>(800);
  readonly multiKinds          = MULTI_KINDS;
  readonly kindDirectionHints: Record<string, { out: string; in: string }> = KIND_DIRECTION_HINTS;
  readonly reverseMode         = signal(false);
  readonly snapshotOpen        = signal(true);
  readonly glossaryOpen        = signal(false);
  readonly crdOpen             = signal(false);
  readonly networkOpen         = signal(false);
  readonly podConfigOpen       = signal(false);
  readonly podConfigKeys       = POD_CONFIG_KEYS;
  readonly selectedPodConfig   = signal<string | null>(null);
  readonly selectedPodConfigEntry = computed(() =>
    POD_CONFIG_KEYS.find(e => e.key === this.selectedPodConfig()) ?? null
  );

  /** All unique namespaces in the graph (for top-level namespace selector). */
  readonly allNamespaces = computed<string[]>(() => {
    if (this.graphData.loading()) return [];
    const nodes = this.graphData.nodes();
    return [...new Set(nodes.map(n => n.namespace).filter((ns): ns is string => !!ns))].sort();
  });

  /** All nodes of the selected kind, filtered by selected namespace. */
  readonly kindNodes = computed<GraphNode[]>(() => {
    const kind = this.selectedGraphKind();
    if (!kind || this.graphData.loading()) return [];
    const ns = this.selectedNamespace();
    const nodes = this.graphData.nodes();
    return nodes.filter(n => n.kind === kind && (!ns || n.namespace === ns));
  });

  /** Nodes to render in the main view — same as kindNodes (namespace already applied). */
  readonly nodesForView = computed<GraphNode[]>(() => {
    const kn = this.kindNodes();
    if (!this.selectedGraphKind() || (!this.selectedNamespace() && kn.length > 1)) return [];
    return kn;
  });

  /** All radial layouts — one per node in the selected namespace. */
  readonly allRadialLayouts = computed<RadialLayoutView[]>(() => {
    const kind = this.selectedGraphKind();
    if (!kind || this.graphData.loading()) return [];
    const nodesToRender = this.nodesForView();
    if (!nodesToRender.length) return [];
    const edges   = this.graphData.edges();
    const nodes   = this.graphData.nodes();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const reverse = this.reverseMode();
    const layouts: RadialLayoutView[] = [];
    for (const srcNode of nodesToRender) {
      const rawTargets = reverse
        ? edges
            .filter(e => e.target === srcNode.id && e.sourceField && nodeMap.has(e.source))
            .map(e => {
              const refNode = nodeMap.get(e.source)!;
              const { sourceLines } = buildSnippet(e.sourceField!, refNode, srcNode);
              return { targetNode: refNode, edge: e, targetLines: sourceLines };
            })
        : edges
            .filter(e => e.source === srcNode.id && e.sourceField && nodeMap.has(e.target))
            .map(e => {
              const tgtNode = nodeMap.get(e.target)!;
              const { targetLines } = buildSnippet(e.sourceField!, srcNode, tgtNode);
              return { targetNode: tgtNode, edge: e, targetLines };
            });
      if (!rawTargets.length) continue;
      const sorted = [...rawTargets].sort((a, b) => {
        const ia = FIELD_SECTION_ORDER.indexOf(a.edge.sourceField!);
        const ib = FIELD_SECTION_ORDER.indexOf(b.edge.sourceField!);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      const combinedLines = reverse
        ? buildSnippet(sorted[0].edge.sourceField!, sorted[0].targetNode, srcNode).targetLines
        : buildCombinedSnippet(srcNode, sorted.map(t => ({ field: t.edge.sourceField!, targetNode: t.targetNode })));
      const mx: MultiExampleView = { sourceNode: srcNode, combinedLines, targets: sorted };
      const rl = buildRadialLayout(mx);
      if (rl) layouts.push(rl);
    }
    return layouts;
  });

  /** Pre-computed radial layout for single-source hub view. */
  readonly radialLayout = computed<RadialLayoutView | null>(() => {
    if (this.allRadialLayouts().length > 0) return null;
    const mx = this.multiExample();
    if (!mx || mx.emptyMsg || mx.podRows) return null;
    return buildRadialLayout(mx);
  });

  private needsPathUpdate = false;

  // Bipartite view disabled — always use single-source radial.
  readonly multiExamples = computed<BipartiteView | null>(() => null);

  // Real-data example — uses live/snapshot cluster graph
  readonly multiExample = computed<MultiExampleView | null>(() => {
    // groupKind field selected: show static multi-example for the group kind
    const field = this.selectedFieldGlossary();
    if (field) {
      const groupKind = FIELD_GLOSSARY[field].groupKind;
      if (groupKind) return buildStaticMultiExample(groupKind);
    }

    const kind = this.selectedGraphKind();
    if (!kind) return null;
    if (this.graphData.loading()) return null;
    const nodes   = this.graphData.nodes();
    const edges   = this.graphData.edges();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const hasData = nodes.length > 0;

    // When multiple nodes exist, wait for the user to select a namespace first
    if (this.kindNodes().length > 1 && !this.selectedNamespace()) return null;

    let srcNode = nodes.find(n => n.kind === kind && (!this.selectedNamespace() || n.namespace === this.selectedNamespace()));

    // Pod is stored separately in graphData.pods(), not in nodes()
    if (!srcNode && kind === 'Pod') {
      const allPods = (Object.values(this.graphData.pods()) as GraphNode[][]).flat();
      srcNode = allPods[0];
    }

    if (!srcNode) {
      if (hasData) {
        return {
          sourceNode: { id: '', name: '', kind, category: 'workload', namespace: '', metadata: {} },
          combinedLines: [],
          targets: [],
          emptyMsg: `No ${kind} found in snapshot`,
        };
      }
      return buildStaticMultiExample(kind);
    }

    // Pod: edges are not in graphData.edges() — build from metadata.
    // Show all pods in the selected namespace (or all if none selected).
    if (kind === 'Pod') {
      const allPods = (Object.values(this.graphData.pods()) as GraphNode[][]).flat();
      const filteredPods = allPods;
      if (!filteredPods.length) {
        return { sourceNode: { id: '', name: '', kind, category: 'workload', namespace: '', metadata: {} }, combinedLines: [], targets: [], emptyMsg: `No Pod found in snapshot` };
      }
      const podRows: PodRow[] = [];
      for (const pod of filteredPods) {
        const ownerKind = pod.metadata['ownerKind'] as NodeKind | undefined;
        const ownerName = pod.metadata['ownerName'] as string | undefined;
        if (!ownerKind || !ownerName) continue;
        const ownerNode = nodeMap.get(`${pod.namespace}/${ownerKind}/${ownerName}`);
        if (!ownerNode) continue;
        const { sourceLines, targetLines } = buildSnippet(SourceField.OwnerReference, pod, ownerNode);
        podRows.push({ podNode: pod, ownerNode, sourceLines, targetLines });
      }
      if (!podRows.length) {
        return { sourceNode: filteredPods[0], combinedLines: [], targets: [], emptyMsg: `No tracked Pod owners found` };
      }
      return { sourceNode: filteredPods[0], combinedLines: [], targets: [], podRows };
    }

    const reverse = this.reverseMode();
    const rawTargets = reverse
      ? edges
          .filter(e => e.target === srcNode!.id && e.sourceField && nodeMap.has(e.source))
          .map(e => {
            const refNode = nodeMap.get(e.source)!;
            const { sourceLines } = buildSnippet(e.sourceField!, refNode, srcNode!);
            return { targetNode: refNode, edge: e, targetLines: sourceLines };
          })
      : edges
          .filter(e => e.source === srcNode!.id && e.sourceField && nodeMap.has(e.target))
          .map(e => {
            const tgtNode = nodeMap.get(e.target)!;
            const { targetLines } = buildSnippet(e.sourceField!, srcNode!, tgtNode);
            return { targetNode: tgtNode, edge: e, targetLines };
          });

    if (!rawTargets.length) {
      if (hasData) {
        return {
          sourceNode: srcNode,
          combinedLines: [],
          targets: [],
          emptyMsg: reverse
            ? `No resources reference ${kind} "${srcNode.name}"`
            : `No outgoing edges found for ${kind} "${srcNode.name}"`,
        };
      }
      return buildStaticMultiExample(kind);
    }

    // Sort by natural YAML section order so bezier lines don't cross
    const sorted = [...rawTargets].sort((a, b) => {
      const ia = FIELD_SECTION_ORDER.indexOf(a.edge.sourceField!);
      const ib = FIELD_SECTION_ORDER.indexOf(b.edge.sourceField!);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    // In incoming mode, the source card shows the referenced resource's YAML
    const combinedLines = reverse
      ? buildSnippet(sorted[0].edge.sourceField!, sorted[0].targetNode, srcNode!).targetLines
      : buildCombinedSnippet(srcNode, sorted.map(t => ({ field: t.edge.sourceField!, targetNode: t.targetNode })));

    return { sourceNode: srcNode, combinedLines, targets: sorted };
  });

  // Static example — pure K8s knowledge, no cluster data needed
  readonly example = computed<ExampleView | null>(() => {
    const field = this.selectedFieldGlossary();
    if (!field) return null;
    if (FIELD_GLOSSARY[field].groupKind) return null;  // grouped fields use radial view
    const ex = STATIC_EXAMPLES[field];
    if (!ex) return null;

    const srcNode: GraphNode = {
      id: `static/${ex.srcKind}/${ex.srcName}`,
      name: ex.srcName, kind: ex.srcKind, category: 'workload',
      namespace: 'default', metadata: {},
    };
    const tgtNode: GraphNode = {
      id: `static/${ex.tgtKind}/${ex.tgtName}`,
      name: ex.tgtName, kind: ex.tgtKind, category: 'abstract',
      namespace: 'default', metadata: {},
    };
    const edge: GraphEdge = {
      source: srcNode.id, target: tgtNode.id,
      type: FIELD_GLOSSARY[field].edgeType, sourceField: field,
    };
    const { sourceLines, targetLines } = buildSnippet(field, srcNode, tgtNode);
    return { sourceNode: srcNode, targetNode: tgtNode, edge, sourceLines, targetLines };
  });

  ngOnInit(): void {
    this.graphData.fetchGraph(true);
    effect(() => {
      this.themeService.activeTheme(); // track theme changes
      this.edgeColors.set(getThemedEdgeColors());
    });
  }

  ngAfterViewChecked(): void {
    if (this.needsPathUpdate) {
      this.needsPathUpdate = false;
      const field = this.selectedFieldGlossary();
      if (field && FIELD_GLOSSARY[field].groupKind) {
        this.updateRadialPaths();
      } else if (field || this.selectedCrdField()) {
        this.updatePath();
      } else if (this.selectedGraphKind()) {
        const mx = this.multiExample();
        if (mx?.podRows) {
          this.updatePodRowPaths();
        } else if (this.radialLayout()) {
          this.updateRadialPaths();
        } else {
          this.updateMultiPaths();
        }
      }
    }
  }

  setReverseMode(value: boolean): void {
    this.reverseMode.set(value);
    this.podRowPaths.set([]);
    this.needsPathUpdate = true;
  }

  protected isFirstHighlight(lines: YamlLine[], idx: number): boolean {
    return lines.findIndex(l => l.highlight) === idx;
  }

  selectNetworkType(type: NetworkType): void {
    this.selectedNetworkType.set(this.selectedNetworkType() === type ? null : type);
    this.selectedFieldGlossary.set(null);
    this.selectedGraphKind.set(null);
    this.selectedCrdField.set(null);
    this.selectedPodConfig.set(null);
  }

  selectPodConfig(key: string): void {
    this.selectedPodConfig.set(this.selectedPodConfig() === key ? null : key);
    this.selectedFieldGlossary.set(null);
    this.selectedGraphKind.set(null);
    this.selectedCrdField.set(null);
    this.selectedNetworkType.set(null);
  }

  selectFieldGlossary(field: SourceField): void {
    this.selectedFieldGlossary.set(this.selectedFieldGlossary() === field ? null : field);
    this.selectedGraphKind.set(null);
    this.selectedCrdField.set(null);
    this.selectedNetworkType.set(null);
    this.connectorPath.set('');
    this.connectorMid.set(null);
    this.dragOffset.set({ x: 0, y: 0 });
    this.scale.set(1);
    this.needsPathUpdate = true;
  }

  selectCrdField(field: CrdField): void {
    this.selectedCrdField.set(this.selectedCrdField() === field ? null : field);
    this.selectedFieldGlossary.set(null);
    this.selectedGraphKind.set(null);
    this.selectedNetworkType.set(null);
    this.connectorPath.set('');
    this.connectorMid.set(null);
    this.dragOffset.set({ x: 0, y: 0 });
    this.scale.set(1);
    this.needsPathUpdate = true;
  }

  selectGraphKind(kind: NodeKind): void {
    this.selectedGraphKind.set(this.selectedGraphKind() === kind ? null : kind);
    this.selectedFieldGlossary.set(null);
    this.selectedCrdField.set(null);
    this.selectedNetworkType.set(null);
    this.reverseMode.set(false);
    this.multiPaths.set([]);
    this.dragOffset.set({ x: 0, y: 0 });
    this.scale.set(1);
    this.needsPathUpdate = true;
  }

  selectNamespace(ns: string): void {
    this.selectedNamespace.set(this.selectedNamespace() === ns ? null : ns);
    this.selectedGraphKind.set(null);
    this.reverseMode.set(false);
    this.radialPaths.set([]);
    this.dragOffset.set({ x: 0, y: 0 });
    this.scale.set(1);
    this.needsPathUpdate = true;
  }

  onDragStart(event: MouseEvent): void {
    if (this.selectedNetworkType()) return;
    this.isDragging.set(true);
    this.dragStart = { x: event.clientX - this.dragOffset().x, y: event.clientY - this.dragOffset().y };
    event.preventDefault();
  }

  onDragMove(event: MouseEvent): void {
    if (!this.isDragging()) return;
    this.dragOffset.set({ x: event.clientX - this.dragStart.x, y: event.clientY - this.dragStart.y });
  }

  onDragEnd(): void {
    this.isDragging.set(false);
  }

  onWheel(event: WheelEvent): void {
    if (this.selectedNetworkType()) return;
    event.preventDefault();
    const oldScale = this.scale();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newScale = Math.min(3, Math.max(0.25, oldScale * factor));

    // Zoom toward mouse cursor
    const rect = this.mainAreaRef!.nativeElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const { x, y } = this.dragOffset();

    this.scale.set(newScale);
    this.dragOffset.set({
      x: mouseX - (mouseX - x) * (newScale / oldScale),
      y: mouseY - (mouseY - y) * (newScale / oldScale),
    });
  }

  private updatePodRowPaths(): void {
    const container = this.podRowsContainerRef?.nativeElement;
    if (!container) return;
    const lefts  = this.podLeftHighlights.toArray();
    const rights = this.podRightHighlights.toArray();
    const count  = Math.min(lefts.length, rights.length);
    if (!count) return;
    const cr = container.getBoundingClientRect();
    const paths: Array<{ d: string; edgeType: EdgeType }> = [];
    for (let i = 0; i < count; i++) {
      const lr = lefts[i].nativeElement.getBoundingClientRect();
      const rr = rights[i].nativeElement.getBoundingClientRect();
      const x1 = lr.right - cr.left;
      const y1 = lr.top + lr.height / 2 - cr.top;
      const x2 = rr.left  - cr.left;
      const y2 = rr.top + rr.height / 2 - cr.top;
      const cx = (x1 + x2) / 2;
      paths.push({ d: `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`, edgeType: EdgeType.Owns });
    }
    this.podRowPaths.set(paths);
  }

  private updateRadialPaths(): void {
    const container = this.radialContainerRef?.nativeElement;
    if (!container) return;
    const srcs = this.radialSrcHighlights.toArray();
    const tgts = this.radialTgtHighlights.toArray();
    const rl   = this.radialLayout();
    if (!rl || srcs.length !== tgts.length) return;

    const cr = container.getBoundingClientRect();
    const paths: Array<{ d: string; edgeType: EdgeType }> = [];

    for (let i = 0; i < srcs.length; i++) {
      const card = rl.cards[i];
      if (!card) continue;

      const sr = srcs[i].nativeElement.getBoundingClientRect();
      const tr = tgts[i].nativeElement.getBoundingClientRect();
      const srcMidY = sr.top + sr.height / 2 - cr.top;
      const tgtMidY = tr.top + tr.height / 2 - cr.top;

      let d = '';
      switch (card.side) {
        case 'right': {
          const x1 = sr.right - cr.left;
          const x2 = tr.left  - cr.left;
          const cx = (x1 + x2) / 2;
          d = `M ${x1} ${srcMidY} C ${cx} ${srcMidY} ${cx} ${tgtMidY} ${x2} ${tgtMidY}`;
          break;
        }
        case 'left': {
          const x1 = sr.left  - cr.left;
          const x2 = tr.right - cr.left;
          const cx = (x1 + x2) / 2;
          d = `M ${x1} ${srcMidY} C ${cx} ${srcMidY} ${cx} ${tgtMidY} ${x2} ${tgtMidY}`;
          break;
        }
        case 'top': {
          const x1 = sr.left + sr.width  / 2 - cr.left;
          const x2 = tr.left + tr.width  / 2 - cr.left;
          const y1 = sr.top  - cr.top;
          const y2 = tr.bottom - cr.top;
          const cy = (y1 + y2) / 2;
          d = `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
          break;
        }
        case 'bottom': {
          const x1 = sr.left + sr.width  / 2 - cr.left;
          const x2 = tr.left + tr.width  / 2 - cr.left;
          const y1 = sr.bottom - cr.top;
          const y2 = tr.top    - cr.top;
          const cy = (y1 + y2) / 2;
          d = `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
          break;
        }
      }
      paths.push({ d, edgeType: card.edge.type });
    }
    this.radialPaths.set(paths);
  }

  private updateMultiPaths(): void {
    const container = this.multiContainerRef?.nativeElement;
    if (!container) return;
    const srcs = this.rowSrcHighlights.toArray();
    const tgts = this.rowTgtHighlights.toArray();
    const count = Math.min(srcs.length, tgts.length);
    const cr = container.getBoundingClientRect();
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      const sr = srcs[i].nativeElement.getBoundingClientRect();
      const tr = tgts[i].nativeElement.getBoundingClientRect();
      const x1 = sr.right  - cr.left;
      const y1 = sr.top + sr.height / 2 - cr.top;
      const x2 = tr.left   - cr.left;
      const y2 = tr.top + tr.height / 2 - cr.top;
      const mx = (x1 + x2) / 2;
      paths.push(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    }
    this.multiPaths.set(paths);
    this.multiSvgH.set(cr.height);
    this.multiSvgW.set(cr.width);
  }

  private updatePath(): void {
    const container = this.cardsContainerRef?.nativeElement;
    const src = this.sourceHighlightRef?.nativeElement;
    const tgt = this.targetHighlightRef?.nativeElement;
    if (!container || !src || !tgt) return;

    const cr = container.getBoundingClientRect();
    const sr = src.getBoundingClientRect();
    const tr = tgt.getBoundingClientRect();

    const x1 = sr.right  - cr.left;
    const y1 = sr.top + sr.height / 2 - cr.top;
    const x2 = tr.left   - cr.left;
    const y2 = tr.top + tr.height / 2 - cr.top;
    const mx = (x1 + x2) / 2;

    this.connectorPath.set(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    this.connectorMid.set({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    this.connectorH.set(cr.height);
    this.connectorW.set(cr.width);
  }

  getEdgeColor(type: EdgeType): string {
    return this.edgeColors()[type] ?? '#556677';
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

}
