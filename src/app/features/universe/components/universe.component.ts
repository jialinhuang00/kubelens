import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ElementRef,
  ViewChild,
  AfterViewInit,
  HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { DecimalPipe, KeyValuePipe } from '@angular/common';
import { DataModeService } from '../../../core/services/data-mode.service';
import { GraphDataService } from '../services/graph-data.service';
import { GraphLayoutService, NodeLabel, NamespaceBoundary } from '../services/graph-layout.service';
import {
  GraphNode,
  GraphEdge,
  GraphDataResponse,
  KIND_COLORS,
  NodeKind,
  NodeCategory,
  PodPhase,
  getCategory,
  EdgeType,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  POD_STATUS_COLORS,
} from '../models/graph.models';

@Component({
  selector: 'app-universe',
  imports: [DecimalPipe, KeyValuePipe],
  templateUrl: './universe.component.html',
  styleUrls: ['./universe.component.scss'],
})
export class UniverseComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly graphData = inject(GraphDataService);
  private readonly graphLayout = inject(GraphLayoutService);
  private readonly router = inject(Router);
  protected readonly dataModeService = inject(DataModeService);

  @ViewChild('graphCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly loading = this.graphData.loading;
  readonly error = this.graphData.error;
  readonly stats = this.graphData.stats;

  // Tooltip state
  readonly hoveredNode = signal<GraphNode | null>(null);
  readonly tooltipPosition = signal<{ x: number; y: number } | null>(null);

  // Selection state
  readonly selectedNode = signal<GraphNode | null>(null);
  readonly selectedEdges = signal<GraphEdge[]>([]);
  readonly connectedNodes = signal<GraphNode[]>([]);

  // Zoom
  readonly zoomLevel = signal(1);

  // Node labels (rendered as HTML overlay)
  readonly nodeLabels = signal<NodeLabel[]>([]);

  // Namespace boundaries
  readonly namespaceBoundaries = signal<NamespaceBoundary[]>([]);

  // Namespace drill-down
  readonly focusedNamespace = signal<string | null>(null);

  // Pod drill-down
  readonly expandedPods = signal<GraphNode[]>([]);
  readonly expandedWorkloadId = signal<string | null>(null);
  private readonly WORKLOAD_KINDS = new Set<NodeKind>(['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob']);
  private dataCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Namespace list for overview panel
  readonly namespaceList = computed(() => {
    const data = this.graphData.data();
    if (!data) return [];
    // Count nodes per namespace
    const nsCounts = new Map<string, number>();
    for (const node of data.nodes) {
      nsCounts.set(node.namespace, (nsCounts.get(node.namespace) ?? 0) + 1);
    }
    return [...nsCounts.entries()]
      .map(([ns, count]) => ({ name: ns, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Important kinds to show in overview (no namespace selected)
  private readonly OVERVIEW_KINDS = new Set<NodeKind>([
    'Namespace', 'Deployment', 'StatefulSet', 'DaemonSet', 'Gateway',
  ]);

  // Filtered labels — overview: only important kinds; focused: all in that namespace
  readonly filteredLabels = computed(() => {
    const ns = this.focusedNamespace();
    const labels = this.nodeLabels();
    if (!ns) {
      return labels.filter(l => this.OVERVIEW_KINDS.has(l.kind));
    }
    return labels.filter(l => {
      const firstSlash = l.id.indexOf('/');
      const labelNs = firstSlash >= 0 ? l.id.substring(0, firstSlash) : '';
      return labelNs === ns;
    });
  });

  // Filtered boundaries — always show all (allow jumping between namespaces)
  readonly filteredBoundaries = computed(() => {
    return this.namespaceBoundaries();
  });

  // Active node IDs (selected + connected OR kind-filtered) for dimming
  readonly activeNodeIds = computed(() => {
    // Namespace focus: dim everything outside focused namespace
    const ns = this.focusedNamespace();
    // Kind filter takes priority
    const kind = this.selectedKind();
    if (kind) {
      const nodes = this.graphData.nodes();
      return new Set(
        nodes.filter(n => n.kind === kind && (!ns || n.namespace === ns)).map(n => n.id)
      );
    }
    // Single node selection
    const selected = this.selectedNode();
    if (!selected) return null; // null = no selection, show all
    const connected = this.connectedNodes();
    return new Set<string>([selected.id, ...connected.map(n => n.id)]);
  });

  readonly selectedKind = signal<NodeKind | null>(null);

  readonly legendGroups = computed(() => {
    const ns = this.focusedNamespace();
    const pods = this.graphData.pods();
    let byKind: Record<string, number> = {};

    if (ns) {
      const nodes = this.graphData.nodes().filter(n => n.namespace === ns);
      for (const n of nodes) {
        byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
      }
      for (const [parentId, podList] of Object.entries(pods)) {
        if (parentId.startsWith(ns + '/')) {
          byKind['Pod'] = (byKind['Pod'] ?? 0) + podList.length;
        }
      }
    } else {
      const stats = this.stats();
      if (!stats) return [];
      byKind = { ...stats.byKind };
      let totalPods = 0;
      for (const podList of Object.values(pods)) {
        totalPods += podList.length;
      }
      if (totalPods > 0) {
        byKind['Pod'] = totalPods;
      }
    }

    // Group by category
    const groups: { category: NodeCategory; label: string; items: { kind: NodeKind; color: string; count: number }[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = Object.entries(byKind)
        .filter(([kind]) => getCategory(kind as NodeKind) === cat)
        .map(([kind, count]) => ({
          kind: kind as NodeKind,
          color: KIND_COLORS[kind as NodeKind] ?? '#888',
          count,
        }))
        .sort((a, b) => b.count - a.count);
      if (items.length > 0) {
        groups.push({ category: cat, label: CATEGORY_LABELS[cat], items });
      }
    }
    return groups;
  });

  // Detail panel: group connected nodes by relationship type
  readonly groupedConnections = computed(() => {
    const node = this.selectedNode();
    if (!node) return [];
    const edges = this.selectedEdges();
    const connected = this.connectedNodes();
    const groups = new Map<EdgeType, { edge: GraphEdge; node: GraphNode }[]>();

    for (const edge of edges) {
      const otherId = edge.source === node.id ? edge.target : edge.source;
      const otherNode = connected.find((n) => n.id === otherId);
      if (!otherNode) continue;
      const list = groups.get(edge.type) ?? [];
      list.push({ edge, node: otherNode });
      groups.set(edge.type, list);
    }

    return Array.from(groups.entries()).map(([type, items]) => ({ type, items }));
  });

  ngOnInit(): void {
    this.graphData.fetchGraph();
  }

  ngAfterViewInit(): void {
    // Wait for data to load, then init graph
    this.dataCheckInterval = setInterval(() => {
      const data = this.graphData.data();
      if (data && this.canvasRef) {
        this.clearDataCheck();
        this.initGraph(data);
      }
      if (this.error()) {
        this.clearDataCheck();
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.clearDataCheck();
    this.graphLayout.destroy();
  }

  private clearDataCheck(): void {
    if (this.dataCheckInterval) {
      clearInterval(this.dataCheckInterval);
      this.dataCheckInterval = null;
    }
  }

  private initGraph(data: import('../models/graph.models').GraphDataResponse): void {
    const canvas = this.canvasRef.nativeElement;
    this.graphLayout.initializeGraph(canvas, data, {
      onNodeHover: (node, position) => {
        this.hoveredNode.set(node);
        if (position) {
          const screenPos = this.graphLayout.spaceToScreen(position);
          this.tooltipPosition.set({ x: screenPos[0], y: screenPos[1] });
        } else {
          this.tooltipPosition.set(null);
        }
      },
      onNodeClick: (node) => {
        if (node) {
          this.selectNode(node);
        } else {
          this.clearSelection();
        }
      },
      onZoom: (level) => {
        this.zoomLevel.set(level);
      },
      onLabelsUpdate: (labels, boundaries) => {
        this.nodeLabels.set(labels);
        this.namespaceBoundaries.set(boundaries);
      },
    });
  }

  selectNode(node: GraphNode): void {
    // Collapse any previously expanded pods
    this.collapsePods();

    this.selectedNode.set(node);
    this.selectedEdges.set(this.graphData.getConnectedEdges(node.id));
    this.connectedNodes.set(this.graphData.getConnectedNodes(node.id));

    // If this is a workload, expand its pods (must happen BEFORE select/focus
    // because addTemporaryNodes calls setData which rebuilds cosmos's index)
    if (this.WORKLOAD_KINDS.has(node.kind)) {
      const pods = this.graphData.getPodsForWorkload(node.id);
      if (pods.length > 0) {
        this.expandedWorkloadId.set(node.id);
        this.expandedPods.set(pods);
        this.graphLayout.addTemporaryNodes(node.id, pods);
      }
    }

    // Select/focus after data is stable
    this.graphLayout.selectNode(node.id);
    this.graphLayout.focusNode(node.id);
  }

  clearSelection(): void {
    this.collapsePods();
    this.selectedNode.set(null);
    this.selectedEdges.set([]);
    this.connectedNodes.set([]);
    this.selectedKind.set(null);
    this.graphLayout.unselectNodes();
    this.graphLayout.unfocusNode();
  }

  private collapsePods(): void {
    if (this.expandedWorkloadId()) {
      this.graphLayout.removeTemporaryNodes();
      this.expandedWorkloadId.set(null);
      this.expandedPods.set([]);
    }
  }

  onConnectedNodeClick(node: GraphNode): void {
    this.selectNode(node);
    this.graphLayout.zoomToNode(node.id);
  }

  focusNamespace(ns: string): void {
    this.clearSelection();
    this.focusedNamespace.set(ns);
    // Zoom to the namespace cluster by selecting all its nodes, then fitting
    const nsNodeIds = this.graphData.nodes()
      .filter(n => n.namespace === ns)
      .map(n => n.id);
    if (nsNodeIds.length > 0) {
      this.graphLayout.selectNodesByIds(nsNodeIds);
      // Zoom to first node as anchor, then fit
      this.graphLayout.zoomToNode(nsNodeIds[0]);
    }
  }

  clearNamespaceFocus(): void {
    this.focusedNamespace.set(null);
    this.clearSelection();
    this.graphLayout.fitView();
  }

  fitView(): void {
    this.graphLayout.fitView();
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  switchMode(snapshot: boolean): void {
    this.dataModeService.setSnapshotMode(snapshot);
    this.graphLayout.destroy();
    this.graphData.fetchGraph();
    this.clearDataCheck();
    this.dataCheckInterval = setInterval(() => {
      const data = this.graphData.data();
      if (data && this.canvasRef) {
        this.clearDataCheck();
        this.clearSelection();
        this.focusedNamespace.set(null);
        this.initGraph(data);
      }
      if (this.error()) {
        this.clearDataCheck();
      }
    }, 100);
  }

  selectKind(kind: NodeKind): void {
    if (this.selectedKind() === kind) {
      // Toggle off
      this.selectedKind.set(null);
      this.selectedNode.set(null);
      this.graphLayout.unselectNodes();
      return;
    }
    this.selectedKind.set(kind);
    this.selectedNode.set(null);
    const ids = this.graphData.nodes()
      .filter((n) => n.kind === kind)
      .map((n) => n.id);
    this.graphLayout.selectNodesByIds(ids);
  }

  getKindColor(kind: NodeKind): string {
    return KIND_COLORS[kind] ?? '#888';
  }

  getPodStatusColor(pod: GraphNode): string {
    const status = (pod.metadata?.['status'] as PodPhase) ?? PodPhase.Unknown;
    return POD_STATUS_COLORS[status] ?? '#e07070';
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.selectedNode() || this.selectedKind()) {
        this.clearSelection();
      } else if (this.focusedNamespace()) {
        this.clearNamespaceFocus();
      }
    }
    if (event.key === 'f' || event.key === 'F') {
      if (!this.selectedNode()) {
        this.fitView();
      }
    }
  }
}
