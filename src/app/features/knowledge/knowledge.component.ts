import {
  Component, OnInit, AfterViewChecked,
  ViewChild, ElementRef,
  signal, computed, inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { KeyValuePipe } from '@angular/common';
import { GraphDataService } from '../universe/services/graph-data.service';
import { DataModeService } from '../../core/services/data-mode.service';
import { BackLinkComponent } from '../../shared/components/back-link/back-link.component';
import { ModeToggleComponent } from '../../shared/components/mode-toggle/mode-toggle.component';
import {
  GraphNode, GraphEdge,
  EdgeType, SourceField,
  getThemedEdgeColors,
} from '../universe/models/graph.models';

// ── Field Glossary data ────────────────────────────────────────────────────

export interface FieldInfo {
  short: string;
  yaml: string;
  edgeType: EdgeType;
}

export const FIELD_GLOSSARY: Record<SourceField, FieldInfo> = {
  [SourceField.ServiceAccountName]: {
    short: 'Runs as ServiceAccount',
    yaml: 'spec.template.spec.serviceAccountName',
    edgeType: EdgeType.UsesServiceAccount,
  },
  [SourceField.EnvFromConfigMap]: {
    short: 'Loads all keys from ConfigMap (env)',
    yaml: 'containers[].envFrom[].configMapRef',
    edgeType: EdgeType.UsesConfigMap,
  },
  [SourceField.EnvFromSecret]: {
    short: 'Loads all keys from Secret (env)',
    yaml: 'containers[].envFrom[].secretRef',
    edgeType: EdgeType.UsesSecret,
  },
  [SourceField.EnvConfigMapKey]: {
    short: 'Reads one key from ConfigMap',
    yaml: 'containers[].env[].valueFrom.configMapKeyRef',
    edgeType: EdgeType.UsesConfigMap,
  },
  [SourceField.EnvSecretKey]: {
    short: 'Reads one key from Secret',
    yaml: 'containers[].env[].valueFrom.secretKeyRef',
    edgeType: EdgeType.UsesSecret,
  },
  [SourceField.VolumePVC]: {
    short: 'Mounts PVC as volume',
    yaml: 'volumes[].persistentVolumeClaim.claimName',
    edgeType: EdgeType.UsesPVC,
  },
  [SourceField.VolumeConfigMap]: {
    short: 'Mounts ConfigMap as volume',
    yaml: 'volumes[].configMap.name',
    edgeType: EdgeType.UsesConfigMap,
  },
  [SourceField.VolumeSecret]: {
    short: 'Mounts Secret as volume',
    yaml: 'volumes[].secret.secretName',
    edgeType: EdgeType.UsesSecret,
  },
  [SourceField.ProjectedConfigMap]: {
    short: 'Projected ConfigMap volume',
    yaml: 'volumes[].projected.sources[].configMap',
    edgeType: EdgeType.UsesConfigMap,
  },
  [SourceField.ProjectedSecret]: {
    short: 'Projected Secret volume',
    yaml: 'volumes[].projected.sources[].secret',
    edgeType: EdgeType.UsesSecret,
  },
  [SourceField.Selector]: {
    short: 'Service selects workload pods',
    yaml: 'spec.selector',
    edgeType: EdgeType.Exposes,
  },
  [SourceField.ParentRefs]: {
    short: 'Route attaches to Gateway',
    yaml: 'spec.parentRefs[].name',
    edgeType: EdgeType.ParentGateway,
  },
  [SourceField.BackendRefs]: {
    short: 'Route forwards traffic to Service',
    yaml: 'spec.rules[].backendRefs[].name',
    edgeType: EdgeType.RoutesTo,
  },
  [SourceField.IngressBackend]: {
    short: 'Ingress forwards to Service backend',
    yaml: 'spec.rules[].http.paths[].backend.service.name',
    edgeType: EdgeType.RoutesTo,
  },
  [SourceField.ScaleTargetRef]: {
    short: 'HPA scales this workload',
    yaml: 'spec.scaleTargetRef.name',
    edgeType: EdgeType.Exposes,
  },
  [SourceField.RoleRef]: {
    short: 'RoleBinding binds this Role',
    yaml: 'roleRef.name',
    edgeType: EdgeType.BindsRole,
  },
  [SourceField.Subjects]: {
    short: 'RoleBinding grants access to ServiceAccount',
    yaml: 'subjects[].name',
    edgeType: EdgeType.BindsRole,
  },
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
    if (tgt.kind === 'ConfigMap' || tgt.kind === 'Secret' || tgt.kind === 'PersistentVolumeClaim'
        || tgt.kind === 'ServiceAccount' || tgt.kind === 'Role') {
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
          s('            - valueFrom:'),
          s('                configMapKeyRef:'),
          s(`                  name: ${name}`, true),
          s('                  key: <key>'),
        ];
      case SourceField.EnvSecretKey:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      containers:'),
          s('        - env:'),
          s('            - valueFrom:'),
          s('                secretKeyRef:'),
          s(`                  name: ${name}`, true),
          s('                  key: <key>'),
        ];
      case SourceField.VolumePVC:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: <vol>'),
          s('          persistentVolumeClaim:'),
          s(`            claimName: ${name}`, true),
        ];
      case SourceField.VolumeConfigMap:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: <vol>'),
          s('          configMap:'),
          s(`            name: ${name}`, true),
        ];
      case SourceField.VolumeSecret:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - name: <vol>'),
          s('          secret:'),
          s(`            secretName: ${name}`, true),
        ];
      case SourceField.ProjectedConfigMap:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - projected:'),
          s('            sources:'),
          s('              - configMap:'),
          s(`                  name: ${name}`, true),
        ];
      case SourceField.ProjectedSecret:
        return [
          s(`# ${src.kind}`),
          s('spec:'), s('  template:'), s('    spec:'),
          s('      volumes:'),
          s('        - projected:'),
          s('            sources:'),
          s('              - secret:'),
          s(`                  name: ${name}`, true),
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
      default:
        return [s(`# ${src.kind}`), s(`  ref: ${name}`, true)];
    }
  })();

  return { sourceLines, targetLines };
}

// ── Component ──────────────────────────────────────────────────────────────

export interface ExampleView {
  sourceNode: GraphNode;
  targetNode: GraphNode;
  edge: GraphEdge;
  sourceLines: YamlLine[];
  targetLines: YamlLine[];
}

@Component({
  selector: 'app-knowledge',
  imports: [KeyValuePipe, BackLinkComponent, ModeToggleComponent],
  templateUrl: './knowledge.component.html',
  styleUrls: ['./knowledge.component.scss'],
})
export class KnowledgeComponent implements OnInit, AfterViewChecked {
  private readonly graphData    = inject(GraphDataService);
  private readonly router       = inject(Router);
  protected readonly dataModeService = inject(DataModeService);

  @ViewChild('sourceHighlight') sourceHighlightRef?: ElementRef<HTMLElement>;
  @ViewChild('targetHighlight') targetHighlightRef?: ElementRef<HTMLElement>;
  @ViewChild('cardsContainer')  cardsContainerRef?: ElementRef<HTMLElement>;

  readonly loading = this.graphData.loading;
  readonly error   = this.graphData.error;

  readonly fieldGlossary  = FIELD_GLOSSARY;
  readonly selectedField  = signal<SourceField | null>(null);
  readonly connectorPath  = signal<string>('');
  readonly connectorH     = signal<number>(200);
  readonly connectorW     = signal<number>(80);

  readonly edgeColors = signal<Record<EdgeType, string>>(getThemedEdgeColors());

  private needsPathUpdate = false;

  // Find the first matching edge + build snippet
  readonly example = computed<ExampleView | null>(() => {
    const field = this.selectedField();
    if (!field) return null;
    const nodes  = this.graphData.nodes();
    const edges  = this.graphData.edges();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const edge = edges.find(e => e.sourceField === field);
    if (!edge) return null;

    const srcNode = nodeMap.get(edge.source);
    const tgtNode = nodeMap.get(edge.target);
    if (!srcNode || !tgtNode) return null;

    const { sourceLines, targetLines } = buildSnippet(field, srcNode, tgtNode);
    return { sourceNode: srcNode, targetNode: tgtNode, edge, sourceLines, targetLines };
  });

  ngOnInit(): void {
    this.graphData.fetchGraph();
  }

  ngAfterViewChecked(): void {
    if (this.needsPathUpdate) {
      this.needsPathUpdate = false;
      this.updatePath();
    }
  }

  selectField(field: SourceField): void {
    this.selectedField.set(this.selectedField() === field ? null : field);
    this.connectorPath.set('');
    this.needsPathUpdate = true;
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
    this.connectorH.set(cr.height);
    this.connectorW.set(cr.width);
  }

  getEdgeColor(type: EdgeType): string {
    return this.edgeColors()[type] ?? '#556677';
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  onModeChanged(): void {
    this.edgeColors.set(getThemedEdgeColors());
    this.graphData.fetchGraph();
  }
}
