import {
  Component, OnInit, AfterViewChecked,
  ViewChild, ViewChildren, ElementRef, QueryList,
  signal, computed, inject, effect,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GraphDataService } from '../universe/services/graph-data.service';
import { DataModeService } from '../../core/services/data-mode.service';
import { ThemeService } from '../../core/services/theme.service';
import { BackLinkComponent } from '../../shared/components/back-link/back-link.component';
import { ThemeSwitcherComponent } from '../../shared/components/theme-switcher/theme-switcher.component';
import { NetworkPatternsComponent, type NetworkType } from './network-patterns/network-patterns.component';
import {
  GraphNode, GraphEdge,
  EdgeType, SourceField, NodeKind,
  getThemedEdgeColors,
} from '../universe/models/graph.models';
import { FIELD_BASE } from '../../shared/models/field-base';

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
    ...FIELD_BASE[SourceField.ServiceAccountName],
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
    ...FIELD_BASE[SourceField.EnvFromConfigMap],
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Bulk-imports every key from ConfigMap as env vars. Key name = env var name, cannot rename. Use when the ConfigMap is purpose-built for this app. If it is shared across apps, use configMapKeyRef instead.',
    usage: [
      'process.env.DB_HOST        // ConfigMap key: DB_HOST',
      'process.env.APP_PORT       // ConfigMap key: APP_PORT',
      '# .env equivalent: DB_HOST=postgres',
    ],
  },
  [SourceField.EnvFromSecret]: {
    ...FIELD_BASE[SourceField.EnvFromSecret],
    edgeType: EdgeType.UsesSecret,
    notes: 'Bulk-imports every key from the Secret as env vars. Use when the Secret belongs exclusively to this app. If other apps share the same Secret, or you only need a subset of keys, use secretKeyRef instead.',
    usage: [
      'process.env.DB_PASSWORD    // Secret key: DB_PASSWORD',
      'process.env.API_KEY        // Secret key: API_KEY',
    ],
  },
  [SourceField.EnvConfigMapKey]: {
    ...FIELD_BASE[SourceField.EnvConfigMapKey],
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Picks a single key from ConfigMap. You control the env var name via the name field. Use when the ConfigMap is shared across apps, you need to rename the key, or only a subset of keys is relevant.',
    usage: [
      '// ConfigMap key: db_host → env var: DATABASE_HOST',
      'process.env.DATABASE_HOST  // your chosen name',
    ],
  },
  [SourceField.EnvSecretKey]: {
    ...FIELD_BASE[SourceField.EnvSecretKey],
    edgeType: EdgeType.UsesSecret,
    notes: 'Picks a single key from the Secret and lets you rename it. Use when the Secret is shared across apps, you only need a subset of keys, or the key name differs from what your app expects as an env var.',
    usage: [
      'process.env.JWT_SECRET     // Secret key: JWT_SECRET',
      'process.env.DATABASE_URL   // Secret key: DATABASE_URL',
      'process.env.OTHER_KEY      // undefined — not listed in env[], must add another secretKeyRef',
    ],
  },
  [SourceField.VolumePVC]: {
    ...FIELD_BASE[SourceField.VolumePVC],
    edgeType: EdgeType.UsesPVC,
    notes: 'Persistent block/file storage. Survives pod restarts and rescheduling. Use for databases, uploaded files, ML model storage. Data lives in the PVC, not the container image.',
    usage: [
      "fs.readFileSync('/data/uploads/file.pdf')",
      '// mount path defined in volumeMounts[].mountPath',
    ],
  },
  [SourceField.VolumeConfigMap]: {
    ...FIELD_BASE[SourceField.VolumeConfigMap],
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Each key in the ConfigMap becomes a file. Use for config files (nginx.conf, app.json, prometheus.yml) instead of env vars — better for multi-line values or structured config.',
    usage: [
      "fs.readFileSync('/etc/config/app.json', 'utf8')",
      '// key name = filename inside the mount path',
    ],
  },
  [SourceField.VolumeSecret]: {
    ...FIELD_BASE[SourceField.VolumeSecret],
    edgeType: EdgeType.UsesSecret,
    notes: 'Same as VolumeConfigMap but for Secrets. Preferred for TLS certs, SSH keys, kubeconfig — binary or multi-line data that does not fit cleanly as env vars.',
    usage: [
      "fs.readFileSync('/etc/certs/tls.crt')",
      "fs.readFileSync('/etc/ssh/id_rsa')",
    ],
  },
  [SourceField.ProjectedConfigMap]: {
    ...FIELD_BASE[SourceField.ProjectedConfigMap],
    edgeType: EdgeType.UsesConfigMap,
    notes: 'Projected volumes combine multiple ConfigMaps and/or Secrets into a single mount path. Use when you need config + certs in the same directory, or want to merge multiple ConfigMaps.',
    usage: [
      '// same as VolumeConfigMap — access via file path',
      "fs.readFileSync('/etc/combined/app.json', 'utf8')",
    ],
  },
  [SourceField.ProjectedSecret]: {
    ...FIELD_BASE[SourceField.ProjectedSecret],
    edgeType: EdgeType.UsesSecret,
    notes: 'Same as ProjectedConfigMap but for Secrets. Often combined with ServiceAccount token projection for custom token audiences.',
    usage: [
      "fs.readFileSync('/etc/combined/tls.crt')",
    ],
  },
  [SourceField.Selector]: {
    ...FIELD_BASE[SourceField.Selector],
    edgeType: EdgeType.Exposes,
    notes: 'Service selector matches Pod labels directly — not the Deployment, not the ReplicaSet. The Deployment\'s spec.template.metadata.labels end up on every Pod it creates. Service finds those Pods at runtime. The graph draws Service → Deployment as a convenience, but the real target is the Pod. If the Deployment changes its pod template labels without updating the Service selector, the Service routes to zero pods — no error, just silent 503s.',
    usage: [
      '// in Node.js: call service by DNS name',
      "fetch('http://my-svc:80/api')  // K8s DNS resolves to ClusterIP",
      '// load balanced across all matching Pods (not Deployment)',
    ],
  },
  [SourceField.ParentRefs]: {
    ...FIELD_BASE[SourceField.ParentRefs],
    edgeType: EdgeType.ParentGateway,
    notes: 'Gateway API (newer than Ingress). HTTPRoute attaches to a Gateway (like an ingress controller). Gateway handles TLS termination; HTTPRoute defines routing rules. Supports traffic splitting, header matching.',
    usage: [
      '// external traffic: https://api.example.com → Gateway → HTTPRoute → Service',
    ],
  },
  [SourceField.BackendRefs]: {
    ...FIELD_BASE[SourceField.BackendRefs],
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
    ...FIELD_BASE[SourceField.IngressBackend],
    edgeType: EdgeType.RoutesTo,
    notes: 'Classic Ingress (pre-Gateway API). Routes HTTP traffic to Services based on host and path. Widely supported but less flexible than Gateway API — no traffic splitting, limited header rules.',
    usage: [
      '# host: api.example.com + path: /v1/* → service',
      "fetch('https://api.example.com/v1/users')",
    ],
  },
  [SourceField.ScaleTargetRef]: {
    ...FIELD_BASE[SourceField.ScaleTargetRef],
    edgeType: EdgeType.Exposes,
    notes: 'HPA continuously monitors metrics (CPU, memory, custom) and adjusts replica count. Pod gets more replicas under load, scales down when idle. Works with Deployment and StatefulSet.',
    usage: [
      '# config: minReplicas: 2, maxReplicas: 10',
      '# targetCPUUtilizationPercentage: 70',
      '// no code change needed — K8s handles scaling',
    ],
  },
  [SourceField.RoleRef]: {
    ...FIELD_BASE[SourceField.RoleRef],
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
    ...FIELD_BASE[SourceField.Subjects],
    edgeType: EdgeType.BindsRole,
    groupKind: 'RoleBinding',
    notes: "The ServiceAccount name here must match the serviceAccountName on the workload pod spec. If they do not match, the pod runs but without the Role's permissions — silent failure.",
    usage: [
      '// subjects[].name === spec.template.spec.serviceAccountName',
      '// mismatch = silent failure (403 when calling K8s API)',
    ],
  },
  [SourceField.OwnerReference]: {
    ...FIELD_BASE[SourceField.OwnerReference],
    edgeType: EdgeType.Owns,
    notes: 'Written by K8s automatically — not by users. Tracks parent-child ownership: Deployment → ReplicaSet → Pod. Enables cascading deletes: delete Deployment, K8s walks ownerReferences to clean up everything.',
    usage: [
      'kubectl delete deployment my-app',
      '// K8s follows ownerReferences → deletes ReplicaSets → deletes Pods',
      '// also used by garbage collector for orphaned resources',
    ],
  },
  [SourceField.IngressTLS]: {
    ...FIELD_BASE[SourceField.IngressTLS],
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
          s(`    app: ${name}`, true),  // matches Pod labels, not Deployment
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

// ── Pod Relation Cards ──────────────────────────────────────────────────────

export interface PodRelationEntry {
  key: string;
  short: string;
  role: string;
  what: string;
  yaml: string;
  trap: string;
}

export const POD_RELATION_ENTRIES: PodRelationEntry[] = [
  {
    key: 'Deployment',
    short: 'Declarative rollout of stateless Pods',
    role: 'CREATES / MANAGES POD',
    what: 'The most common workload. Owns a ReplicaSet which owns Pods. You declare desired state; Deployment handles rolling updates, rollbacks, and scaling. On update it creates a new ReplicaSet, gradually shifts traffic, then scales down the old one.',
    yaml: `apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # one extra Pod during update
      maxUnavailable: 0  # never go below desired count
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:2.0`,
    trap: 'kubectl apply with a new image tag does NOT wait for rollout to finish. Use kubectl rollout status deployment/my-app in CI to block until healthy, or a failed deploy silently leaves half the Pods on the old version.',
  },
  {
    key: 'CronJob',
    short: 'Scheduled Jobs on a cron expression',
    role: 'CREATES / MANAGES POD',
    what: 'Creates a Job on a schedule (cron syntax). Each Job creates one or more Pods. Old Jobs and their Pods are kept for history (controlled by successfulJobsHistoryLimit / failedJobsHistoryLimit). Use for backups, report generation, cache warming.',
    yaml: `apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "0 2 * * *"          # 02:00 UTC every day
  concurrencyPolicy: Forbid       # skip if previous run still going
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: my-app:1.0
              command: ["./backup.sh"]`,
    trap: 'concurrencyPolicy: Allow (default) means two runs overlap if the previous one is still running. A slow backup job can accumulate dozens of running Pods. Set Forbid or Replace.',
  },
  {
    key: 'ReplicaSet',
    short: 'Maintains N Pod replicas',
    role: 'CREATES / MANAGES POD',
    what: 'Keeps exactly N identical Pods running at all times. If a Pod crashes, ReplicaSet creates a replacement. In practice you never touch ReplicaSet directly — Deployment owns one and swaps it during rolling updates.',
    yaml: `apiVersion: apps/v1
kind: ReplicaSet
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app   # must match template labels
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:1.0`,
    trap: 'Editing a ReplicaSet directly does not update running Pods — only newly created ones pick up the change. Use Deployment for rolling updates.',
  },
  {
    key: 'StatefulSet',
    short: 'Stable identity Pods, ordered startup',
    role: 'CREATES / MANAGES POD',
    what: 'Each Pod gets a persistent DNS name: pod-0, pod-1, pod-2. Pods start in order and are replaced with the same name. PVCs are pinned per-ordinal — pod-0 always gets the same storage. Use for databases, Kafka, Zookeeper.',
    yaml: `apiVersion: apps/v1
kind: StatefulSet
spec:
  serviceName: "mysql"   # headless Service required
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi`,
    trap: 'Forgetting the headless Service (clusterIP: None). Without it, the stable DNS names pod-0.mysql, pod-1.mysql do not resolve.',
  },
  {
    key: 'DaemonSet',
    short: 'One Pod per node, auto-scheduled',
    role: 'CREATES / MANAGES POD',
    what: 'Kubernetes places exactly one Pod on every node automatically. New nodes added to the cluster get the Pod immediately. Nodes removed — the Pod is garbage collected. Use for log collectors (Fluentd), node monitors (Prometheus node-exporter), CNI plugins.',
    yaml: `apiVersion: apps/v1
kind: DaemonSet
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    spec:
      tolerations:
        - key: node-role.kubernetes.io/master
          effect: NoSchedule   # run on control-plane too
      containers:
        - name: fluentd
          image: fluentd:v1.16`,
    trap: 'Control-plane nodes have a NoSchedule taint by default. Without a toleration the DaemonSet skips them — logs from the control plane are silently missing.',
  },
  {
    key: 'Job',
    short: 'Pod that runs once and exits',
    role: 'CREATES / MANAGES POD',
    what: 'Runs one or more Pods to completion. Once all succeed, the Job is done. Failed Pods are retried up to backoffLimit. Use for DB migrations, batch processing, one-off scripts.',
    yaml: `apiVersion: batch/v1
kind: Job
spec:
  completions: 1
  backoffLimit: 3   # retry up to 3 times on failure
  template:
    spec:
      restartPolicy: Never   # OnFailure or Never — not Always
      containers:
        - name: migrate
          image: my-app:1.0
          command: ["./migrate.sh"]`,
    trap: 'restartPolicy: Always is not allowed. Use Never (creates a new Pod on failure) or OnFailure (restarts the container in-place).',
  },
  {
    key: 'ConfigMap',
    short: 'Inject non-secret config into Pods',
    role: 'ATTACHED TO POD',
    what: 'Stores plain-text config: env vars, config files, command-line args. Mounted as env vars (envFrom / valueFrom) or as files in a volume. Changes to a ConfigMap are NOT automatically picked up by running Pods — you need to restart them.',
    yaml: `apiVersion: v1
kind: ConfigMap
data:
  APP_PORT: "8080"
  config.yaml: |
    log_level: info
    db_host: postgres
---
# Consuming in a Pod:
envFrom:
  - configMapRef:
      name: my-config   # all keys become env vars
volumes:
  - name: cfg
    configMap:
      name: my-config   # mount as files`,
    trap: 'A volume-mounted ConfigMap updates in ~60s, but envFrom does not — env vars are baked at Pod start. Apps that need hot reload must use volume mounts and watch the file.',
  },
  {
    key: 'Secret',
    short: 'Inject sensitive data into Pods',
    role: 'ATTACHED TO POD',
    what: 'Same mechanics as ConfigMap but values are base64-encoded and access is controlled by RBAC. Stored in etcd — encrypt etcd at rest in production. Types: Opaque (generic), kubernetes.io/tls (cert+key), kubernetes.io/dockerconfigjson (registry auth).',
    yaml: `apiVersion: v1
kind: Secret
type: Opaque
data:
  DB_PASSWORD: cGFzc3dvcmQ=   # base64
---
# Consuming in a Pod:
envFrom:
  - secretRef:
      name: my-secret
volumes:
  - name: tls
    secret:
      secretName: my-tls-cert   # mounts tls.crt, tls.key`,
    trap: 'base64 is encoding, not encryption. Anyone with kubectl get secret can decode it. Enable etcd encryption at rest and restrict access with RBAC.',
  },
  {
    key: 'PersistentVolumeClaim',
    short: 'Durable storage that survives Pod restarts',
    role: 'ATTACHED TO POD',
    what: 'A claim for storage from the cluster. The cluster binds it to a PersistentVolume (physical disk). The PVC outlives the Pod — delete the Pod and recreate it, the data is still there. Use for databases, uploaded files, ML model checkpoints.',
    yaml: `apiVersion: v1
kind: PersistentVolumeClaim
spec:
  accessModes: [ReadWriteOnce]   # one node at a time
  storageClassName: gp2
  resources:
    requests:
      storage: 20Gi
---
# Consuming in a Pod:
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: my-pvc
containers:
  - volumeMounts:
      - mountPath: /data
        name: data`,
    trap: 'ReadWriteOnce means one NODE, not one Pod. Two Pods on the same node can both mount it. For truly shared storage across nodes use ReadWriteMany (requires NFS or cloud-specific driver).',
  },
  {
    key: 'ServiceAccount',
    short: 'Pod identity for K8s API calls',
    role: 'ATTACHED TO POD',
    what: 'Every Pod runs as a ServiceAccount. K8s auto-mounts a token at /var/run/secrets/kubernetes.io/serviceaccount/token. The Pod uses this token to authenticate with the K8s API. Bind a Role to the SA to grant specific permissions.',
    yaml: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app
---
# Bind a Role:
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
subjects:
  - kind: ServiceAccount
    name: my-app
roleRef:
  kind: Role
  name: pod-reader
---
# Use in Deployment:
spec:
  template:
    spec:
      serviceAccountName: my-app`,
    trap: 'The default ServiceAccount has no permissions — that is intentional. Create a dedicated SA per app and bind only the permissions it needs. Never share SAs across apps.',
  },
  {
    key: 'Service',
    short: 'Stable endpoint, load-balances to Pods',
    role: 'SELECTS POD',
    what: 'Watches for Pods matching its label selector and maintains an endpoint list. Traffic to the Service is round-robin distributed across healthy Pods. Gives Pods a stable DNS name and IP even as Pods are replaced. Types: ClusterIP (internal), NodePort (external via node), LoadBalancer (cloud LB).',
    yaml: `apiVersion: v1
kind: Service
spec:
  selector:
    app: my-app   # matches Pod labels
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
---
# DNS name inside cluster:
# my-service.my-namespace.svc.cluster.local`,
    trap: 'selector matches labels on the Pod template, not on the Deployment. If the Deployment label and Pod template label differ, the Service gets zero endpoints — no error, just silent 503s.',
  },
  {
    key: 'HorizontalPodAutoscaler',
    short: 'Auto-scales replicas on metrics',
    role: 'SELECTS POD',
    what: 'Polls Pod metrics (CPU, memory, custom) every 15s. Computes desired replicas = ceil(current × (current metric / target metric)). Scales up immediately, scales down conservatively (5-min window by default). Requires metrics-server to be installed.',
    yaml: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # scale up above 70%`,
    trap: 'HPA and manual replica edits conflict — the HPA will override your manual change on the next sync. Set minReplicas = maxReplicas to pin it, or remove the HPA entirely.',
  },
  {
    key: 'NetworkPolicy',
    short: 'Firewall rules for Pod traffic',
    role: 'SELECTS POD',
    what: 'Selects Pods via podSelector and defines which ingress and egress traffic is allowed. Default: all traffic allowed. Once any NetworkPolicy selects a Pod, all traffic not explicitly allowed is denied. Requires a CNI plugin that supports NetworkPolicy (Calico, Cilium — not Flannel).',
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
spec:
  podSelector:
    matchLabels:
      app: my-app   # applies to these Pods
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend   # only from frontend Pods
      ports:
        - port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: database`,
    trap: 'NetworkPolicy is additive — multiple policies are ORed together, not ANDed. A deny-all + allow-specific pattern requires the deny-all to select the same Pods. Missing podSelector: {} (empty = all Pods) is a common oversight.',
  },
  {
    key: 'PodDisruptionBudget',
    short: 'Limits voluntary Pod evictions',
    role: 'SELECTS POD',
    what: 'Sets a floor on how many Pods must stay available during voluntary disruptions: node drains, rolling updates, cluster upgrades. Does NOT protect against node crashes or OOM kills — only voluntary evictions. Use it to prevent a Deployment from going to zero during a kubectl drain.',
    yaml: `apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  # Choose one: minAvailable OR maxUnavailable
  minAvailable: 2          # at least 2 Pods must stay up
  # maxUnavailable: 1      # OR at most 1 Pod can be down
  selector:
    matchLabels:
      app: my-app          # same labels as your Pod template
---
# Common pattern for a 3-replica Deployment:
# minAvailable: 2  → drain evicts 1 Pod at a time
# maxUnavailable: 1 → equivalent, pick whichever reads clearer`,
    trap: 'minAvailable: 100% (or equal to replicas) blocks node drains entirely — the eviction API returns 429 and kubectl drain hangs forever. Always leave at least one Pod evictable.',
  },
];

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
  imports: [BackLinkComponent, ThemeSwitcherComponent, NetworkPatternsComponent, RouterLink],
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

  readonly selectedNetworkType   = signal<NetworkType | null>(null);
  readonly networkSections: { label: string; types: NetworkType[] }[] = [
    { label: 'SERVICE TYPE', types: ['ClusterIP', 'NodePort', 'LoadBalancer'] },
    { label: 'TOPOLOGY',     types: ['NodeNamespace', 'WorkloadTypes'] },
    { label: 'ROUTING',      types: ['Ingress', 'Gateway'] },
    { label: 'PROXY MODE',   types: ['ProxyMode'] },
    { label: 'CLUSTER',      types: ['MasterWorker', 'PodLifecycle', 'ScenarioDeploy', 'ScenarioCrash', 'ScenarioTraffic'] },
    { label: 'INTERFACES',   types: ['Interfaces'] },
  ];
  readonly glossaryOpen        = signal(false);
  readonly crdOpen             = signal(false);
  readonly networkOpen         = signal(false);
  readonly podConfigOpen       = signal(false);
  readonly podRelationsOpen    = signal(false);
  readonly podConfigKeys       = POD_CONFIG_KEYS;
  readonly podRelationGroups   = [
    { label: 'CREATES / MANAGES POD', keys: ['Deployment', 'CronJob', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job'] },
    { label: 'ATTACHED TO POD',       keys: ['ConfigMap', 'Secret', 'PersistentVolumeClaim', 'ServiceAccount'] },
    { label: 'SELECTS POD',           keys: ['Service', 'HorizontalPodAutoscaler', 'NetworkPolicy', 'PodDisruptionBudget'] },
  ];
  readonly podRelationMap      = Object.fromEntries(POD_RELATION_ENTRIES.map(e => [e.key, e]));
  readonly selectedPodConfig   = signal<string | null>(null);
  readonly selectedPodConfigEntry = computed(() =>
    POD_CONFIG_KEYS.find(e => e.key === this.selectedPodConfig()) ?? null
  );

  readonly selectedPodRelation = signal<string | null>(null);
  readonly selectedPodRelationEntry = computed(() =>
    POD_RELATION_ENTRIES.find(e => e.key === this.selectedPodRelation()) ?? null
  );

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

  private needsPathUpdate = false;

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
      if (this.selectedFieldGlossary() || this.selectedCrdField()) {
        this.updatePath();
      }
    }
  }


  protected isFirstHighlight(lines: YamlLine[], idx: number): boolean {
    return lines.findIndex(l => l.highlight) === idx;
  }

  selectNetworkType(type: NetworkType): void {
    this.selectedNetworkType.set(this.selectedNetworkType() === type ? null : type);
    this.selectedFieldGlossary.set(null);
    this.selectedCrdField.set(null);
    this.selectedPodConfig.set(null);
  }

  selectPodRelation(key: string): void {
    this.selectedPodRelation.set(this.selectedPodRelation() === key ? null : key);
    this.selectedFieldGlossary.set(null);
    this.selectedCrdField.set(null);
    this.selectedNetworkType.set(null);
    this.selectedPodConfig.set(null);
  }

  selectPodConfig(key: string): void {
    this.selectedPodConfig.set(this.selectedPodConfig() === key ? null : key);
    this.selectedFieldGlossary.set(null);
    this.selectedCrdField.set(null);
    this.selectedNetworkType.set(null);
    this.selectedPodRelation.set(null);
  }

  selectFieldGlossary(field: SourceField): void {
    this.selectedFieldGlossary.set(this.selectedFieldGlossary() === field ? null : field);
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
    this.selectedNetworkType.set(null);
    this.connectorPath.set('');
    this.connectorMid.set(null);
    this.dragOffset.set({ x: 0, y: 0 });
    this.scale.set(1);
    this.needsPathUpdate = true;
  }



  readonly isCheatsheetActive = computed(() =>
    !this.selectedFieldGlossary() &&
    !this.selectedCrdField() && !this.selectedNetworkType() &&
    !this.selectedPodConfig() && !this.selectedPodRelation()
  );

  onDragStart(event: MouseEvent): void {
    if (this.selectedNetworkType()) return;
    if (this.isCheatsheetActive()) return;
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
    if (this.isCheatsheetActive()) return;
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
