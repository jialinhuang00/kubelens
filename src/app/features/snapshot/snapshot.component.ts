import {
  Component, OnInit, AfterViewChecked,
  ViewChild, ViewChildren, ElementRef, QueryList,
  signal, computed, effect, inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { GraphDataService } from '../universe/services/graph-data.service';
import { DataModeService } from '../../core/services/data-mode.service';
import { ThemeService } from '../../core/services/theme.service';
import { BackLinkComponent } from '../../shared/components/back-link/back-link.component';
import { NamespaceChipsComponent } from '../../shared/components/namespace-chips/namespace-chips.component';
import { ThemeSwitcherComponent } from '../../shared/components/theme-switcher/theme-switcher.component';
import {
  GraphNode, GraphEdge,
  EdgeType, SourceField, NodeKind,
  getThemedEdgeColors,
} from '../universe/models/graph.models';
import {
  YamlLine,
  RadialCardView,
  RadialLayoutView,
  MultiExampleView,
  PodRow,
  BipartiteCard,
  BipartiteView,
  FIELD_GLOSSARY,
} from '../knowledge/knowledge.component';

// ── Snapshot-specific constants ─────────────────────────────────────────────

export const MULTI_KINDS: NodeKind[] = [
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

// ── YAML snippet builder ─────────────────────────────────────────────────────

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

function buildCombinedSnippet(
  src: GraphNode,
  fieldTargets: Array<{ field: SourceField; targetNode: GraphNode }>,
): YamlLine[] {
  const s = (text: string, highlight = false): YamlLine => ({ text, highlight });

  const fieldNames = new Map<SourceField, string[]>();
  for (const { field, targetNode } of fieldTargets) {
    if (!fieldNames.has(field)) fieldNames.set(field, []);
    fieldNames.get(field)!.push(targetNode.name);
  }
  const has   = (f: SourceField) => fieldNames.has(f);
  const names = (f: SourceField) => fieldNames.get(f) ?? [];

  const lines: YamlLine[] = [];
  lines.push(s(`# ${src.kind}`));

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

  if (src.kind === 'Service') {
    lines.push(s('spec:'), s('  selector:'));
    for (const name of names(SourceField.Selector)) {
      lines.push(s(`    app: ${name}`, true));
    }
  }

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

// Incoming (reverse) static examples: resources that point TO the selected kind
const STATIC_MULTI_EXAMPLES_REVERSE: Partial<Record<NodeKind, { field: SourceField; srcKind: NodeKind; srcName: string }[]>> = {
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

function buildStaticMultiExampleReverse(kind: NodeKind): MultiExampleView | null {
  const defs = STATIC_MULTI_EXAMPLES_REVERSE[kind];
  if (!defs) return null;

  const tgtNode: GraphNode = {
    id: `static/${kind}/my-app`, name: 'my-app', kind,
    category: 'workload', namespace: 'default', metadata: {},
  };

  const targets = defs.map(def => {
    const srcNode: GraphNode = {
      id: `static/${def.srcKind}/${def.srcName}`, name: def.srcName, kind: def.srcKind,
      category: 'abstract', namespace: 'default', metadata: {},
    };
    const edge: GraphEdge = {
      source: srcNode.id, target: tgtNode.id,
      type: FIELD_GLOSSARY[def.field].edgeType, sourceField: def.field,
    };
    // In reverse mode, targetLines = the SOURCE resource's YAML (showing how it refs the selected kind)
    const { sourceLines } = buildSnippet(def.field, srcNode, tgtNode);
    return { targetNode: srcNode, edge, targetLines: sourceLines };
  });

  const combinedLines = buildSnippet(defs[0].field,
    { id: `static/${defs[0].srcKind}/${defs[0].srcName}`, name: defs[0].srcName, kind: defs[0].srcKind, category: 'abstract', namespace: 'default', metadata: {} },
    tgtNode,
  ).sourceLines;

  return { sourceNode: tgtNode, combinedLines, targets };
}

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

  const assignments = mx.targets.map(t =>
    (t.edge.sourceField ? SIDE_BY_FIELD[t.edge.sourceField] : undefined) ?? 'right' as const,
  );

  const idxBySide: Record<string, number[]> = { right: [], bottom: [], left: [], top: [] };
  for (let i = 0; i < assignments.length; i++) idxBySide[assignments[i]].push(i);

  if (!idxBySide['left'].length && idxBySide['right'].length > 3) {
    idxBySide['left'].push(...idxBySide['right'].splice(-Math.floor(idxBySide['right'].length / 2)));
  }

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

  const leftExtent = idxBySide['left'].length  > 0 ? cardW + sideGap : 0;
  const topExtent  = idxBySide['top'].length   > 0 ? topMaxH + sideGap : 0;
  const maxVert    = Math.max(rightH, leftH, srcH);
  const srcX = Math.max(pad + leftExtent, pad + Math.max(0, (topW - srcW) / 2), pad + Math.max(0, (botW - srcW) / 2));
  const srcY = pad + topExtent + Math.max(0, (maxVert - srcH) / 2);

  const srcHlIndices = srcLines.map((l, i) => l.highlight ? i : -1).filter(i => i >= 0);

  const cards: RadialCardView[] = new Array(mx.targets.length);

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

  const canvasW = Math.max(
    srcX + srcW + (idxBySide['right'].length > 0 ? sideGap + cardW : 0) + pad,
    srcX + srcW / 2 + topW / 2 + pad,
    srcX + srcW / 2 + botW / 2 + pad,
  );
  const canvasH = Math.max(
    srcY + (maxVert - srcH) / 2 + maxVert + (idxBySide['bottom'].length > 0 ? sideGap + botMaxH : 0) + pad,
    pad + topExtent + maxVert + pad,
  );

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

// ── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-snapshot',
  imports: [BackLinkComponent, ThemeSwitcherComponent, NamespaceChipsComponent],
  templateUrl: './snapshot.component.html',
  styleUrls: ['./snapshot.component.scss'],
})
export class SnapshotComponent implements OnInit, AfterViewChecked {
  protected readonly graphData       = inject(GraphDataService);
  private readonly router            = inject(Router);
  protected readonly dataModeService = inject(DataModeService);
  private readonly themeService      = inject(ThemeService);

  @ViewChildren('radialSrcHL') radialSrcHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('radialTgtHL') radialTgtHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('radialContainer') radialContainerRef?: ElementRef<HTMLElement>;
  readonly radialPaths = signal<Array<{ d: string; edgeType: EdgeType }>>([]);

  @ViewChildren('podLeftHL')  podLeftHighlights!:  QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('podRightHL') podRightHighlights!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('podRowsContainer') podRowsContainerRef?: ElementRef<HTMLElement>;
  readonly podRowPaths = signal<Array<{ d: string; edgeType: EdgeType }>>([]);

  @ViewChild('mainArea') mainAreaRef?: ElementRef<HTMLElement>;

  readonly loading = this.graphData.loading;
  readonly error   = this.graphData.error;

  readonly selectedGraphKind  = signal<NodeKind | null>(null);
  readonly selectedNamespace  = signal<string | null>(null);
  readonly reverseMode        = signal(false);
  readonly isDragging         = signal(false);
  readonly dragOffset         = signal({ x: 0, y: 0 });
  readonly scale              = signal(1);
  private  dragStart          = { x: 0, y: 0 };

  readonly multiPaths         = signal<string[]>([]);
  readonly connectorPath      = signal<string>('');
  readonly connectorH         = signal<number>(200);
  readonly connectorW         = signal<number>(80);
  readonly connectorMid       = signal<{ x: number; y: number } | null>(null);

  readonly edgeColors = signal<Record<EdgeType, string>>(getThemedEdgeColors());

  readonly multiKinds          = MULTI_KINDS;
  readonly kindDirectionHints: Record<string, { out: string; in: string }> = KIND_DIRECTION_HINTS;

  private needsPathUpdate = false;

  /** All unique namespaces in the graph. */
  readonly allNamespaces = computed<string[]>(() => {
    if (this.graphData.loading()) return [];
    const nodes = this.graphData.nodes();
    return [...new Set(nodes.map(n => n.namespace).filter((ns): ns is string => !!ns))].sort();
  });

  /** All nodes of the selected kind, filtered by namespace. */
  readonly kindNodes = computed<GraphNode[]>(() => {
    const kind = this.selectedGraphKind();
    if (!kind || this.graphData.loading()) return [];
    const ns = this.selectedNamespace();
    const nodes = this.graphData.nodes();
    return nodes.filter(n => n.kind === kind && (!ns || n.namespace === ns));
  });

  /** Nodes to render — namespace filter already applied. */
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

  /** Radial layout for single-source hub view. */
  readonly radialLayout = computed<RadialLayoutView | null>(() => {
    if (this.allRadialLayouts().length > 0) return null;
    const mx = this.multiExample();
    if (!mx || mx.emptyMsg || mx.podRows) return null;
    return buildRadialLayout(mx);
  });

  /** Bipartite view — disabled, always use radial. */
  readonly multiExamples = computed<BipartiteView | null>(() => null);

  /** Live/snapshot cluster graph example. */
  readonly multiExample = computed<MultiExampleView | null>(() => {
    const kind = this.selectedGraphKind();
    if (!kind) return null;
    if (this.graphData.loading()) return null;
    const nodes   = this.graphData.nodes();
    const edges   = this.graphData.edges();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const hasData = nodes.length > 0;

    if (this.kindNodes().length > 1 && !this.selectedNamespace()) return null;

    let srcNode = nodes.find(n => n.kind === kind && (!this.selectedNamespace() || n.namespace === this.selectedNamespace()));

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
      return reverse ? (buildStaticMultiExampleReverse(kind) ?? buildStaticMultiExample(kind)) : buildStaticMultiExample(kind);
    }

    const sorted = [...rawTargets].sort((a, b) => {
      const ia = FIELD_SECTION_ORDER.indexOf(a.edge.sourceField!);
      const ib = FIELD_SECTION_ORDER.indexOf(b.edge.sourceField!);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const combinedLines = reverse
      ? buildSnippet(sorted[0].edge.sourceField!, sorted[0].targetNode, srcNode!).targetLines
      : buildCombinedSnippet(srcNode, sorted.map(t => ({ field: t.edge.sourceField!, targetNode: t.targetNode })));

    return { sourceNode: srcNode, combinedLines, targets: sorted };
  });

  ngOnInit(): void {
    this.graphData.fetchGraph(true);
    effect(() => {
      this.themeService.activeTheme();
      this.edgeColors.set(getThemedEdgeColors());
    });
  }

  ngAfterViewChecked(): void {
    if (this.needsPathUpdate) {
      this.needsPathUpdate = false;
      if (this.selectedGraphKind()) {
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

  selectGraphKind(kind: NodeKind): void {
    this.selectedGraphKind.set(this.selectedGraphKind() === kind ? null : kind);
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

  setReverseMode(value: boolean): void {
    this.reverseMode.set(value);
    this.podRowPaths.set([]);
    this.needsPathUpdate = true;
  }

  onDragStart(event: MouseEvent): void {
    if (!this.selectedGraphKind()) return;
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
    if (!this.selectedGraphKind()) return;
    event.preventDefault();
    const oldScale = this.scale();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newScale = Math.min(3, Math.max(0.25, oldScale * factor));

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

  protected isFirstHighlight(lines: YamlLine[], idx: number): boolean {
    return lines.findIndex(l => l.highlight) === idx;
  }

  getEdgeColor(type: EdgeType): string {
    return this.edgeColors()[type] ?? '#556677';
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
    this.multiPaths.set([]);
  }
}
