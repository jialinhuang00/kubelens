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
import { DecimalPipe, KeyValuePipe, NgTemplateOutlet } from '@angular/common';
import { DataModeService } from '../../../core/services/data-mode.service';
import { ModeToggleComponent } from '../../../shared/components/mode-toggle/mode-toggle.component';
import { ThemeSwitcherComponent } from '../../../shared/components/theme-switcher/theme-switcher.component';
import { BackLinkComponent } from '../../../shared/components/back-link/back-link.component';
import { NamespaceChipsComponent } from '../../../shared/components/namespace-chips/namespace-chips.component';
import { GraphDataService } from '../services/graph-data.service';
import { GraphLayoutService, NodeLabel, NamespaceBoundary } from '../services/graph-layout.service';
import {
  GraphNode,
  GraphEdge,
  GraphDataResponse,
  getThemedKindColors,
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
  imports: [DecimalPipe, KeyValuePipe, NgTemplateOutlet, ModeToggleComponent, ThemeSwitcherComponent, BackLinkComponent, NamespaceChipsComponent],
  templateUrl: './universe.component.html',
  styleUrls: ['./universe.component.scss'],
})
export class UniverseComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly graphData = inject(GraphDataService);
  private readonly graphLayout = inject(GraphLayoutService);
  private readonly router = inject(Router);
  protected readonly dataModeService = inject(DataModeService);

  @ViewChild('graphCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

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

  // Theme-aware kind color palette (read once at init, refreshed on mode change)
  readonly kindColors = signal<Record<NodeKind, string>>(getThemedKindColors());

  // Sidebar collapse
  readonly sidebarCollapsed = signal(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  // Floating detail panel position + drag
  readonly detailPanelPos = signal({ x: 16, y: 60 });
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };

  onDetailPanelMouseDown(_event: MouseEvent): void {
    // Prevent graph clicks when clicking the panel
    _event.stopPropagation();
  }

  onDragStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = true;
    const pos = this.detailPanelPos();
    this.dragOffset = { x: event.clientX - pos.x, y: event.clientY - pos.y };

    const onMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      this.detailPanelPos.set({
        x: e.clientX - this.dragOffset.x,
        y: e.clientY - this.dragOffset.y,
      });
    };
    const onUp = () => {
      this.dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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

  readonly namespaceNames = computed(() => this.namespaceList().map(ns => ns.name));

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

  // Active node IDs (selected + connected OR kind-filtered OR search) for dimming
  readonly activeNodeIds = computed(() => {
    const ns = this.focusedNamespace();
    // Kind filter takes priority
    const kind = this.selectedKind();
    if (kind) {
      const nodes = this.graphData.nodes();
      return new Set(
        nodes.filter(n => n.kind === kind && (!ns || n.namespace === ns)).map(n => n.id)
      );
    }
    // Search filter
    const searchIds = this.searchMatchIds();
    if (this.searchText() && searchIds.size > 0) {
      return searchIds;
    }
    // Single node selection
    const selected = this.selectedNode();
    if (!selected) return null; // null = no selection, show all
    const connected = this.connectedNodes();
    return new Set<string>([selected.id, ...connected.map(n => n.id)]);
  });

  // Search (namespace-scoped)
  readonly searchText = signal('');
  readonly searchResults = computed(() => {
    const text = this.searchText().toLowerCase();
    const ns = this.focusedNamespace();
    if (!text || !ns) return [];
    return this.graphData.nodes().filter(
      n => n.namespace === ns && (n.name.toLowerCase().includes(text) || n.kind.toLowerCase().includes(text))
    );
  });
  readonly searchMatchIds = computed(() => new Set(this.searchResults().map(n => n.id)));
  readonly searchHighlightIndex = signal(-1);
  readonly searchOpen = signal(false);

  // Global search (Cmd+K palette)
  readonly globalSearchOpen = signal(false);
  readonly globalSearchText = signal('');
  readonly globalSearchIndex = signal(-1);
  @ViewChild('globalSearchInput') globalSearchInputRef!: ElementRef<HTMLInputElement>;

  readonly globalSearchResults = computed(() => {
    const text = this.globalSearchText().toLowerCase().trim();
    if (!text) return [];
    const tokens = text.split(/[\s\/]+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const nodes = this.graphData.nodes();

    const scored: { node: GraphNode; score: number }[] = [];
    for (const n of nodes) {
      const candidate = `${n.kind}/${n.name} ${n.namespace}`.toLowerCase();
      const score = this.fuzzyScore(tokens, candidate, n.name.toLowerCase(), text);
      if (score > 0) scored.push({ node: n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map(s => s.node);
  });

  /**
   * Fuzzy scoring: each token is matched against candidate with sequential
   * character matching (characters must appear in order, not necessarily
   * contiguous). Substring hits score higher than sparse fuzzy hits.
   */
  private fuzzyScore(tokens: string[], candidate: string, name: string, raw: string): number {
    // Exact full match
    if (name === raw) return 1000;

    let total = 0;
    for (const token of tokens) {
      // Try substring first (best)
      const subIdx = candidate.indexOf(token);
      if (subIdx >= 0) {
        // Bonus: starts at word boundary (after /, -, space, or position 0)
        const boundary = subIdx === 0 || '/- '.includes(candidate[subIdx - 1]);
        total += 50 + token.length * 2 + (boundary ? 20 : 0) + (name.includes(token) ? 15 : 0);
        continue;
      }
      // Fallback: fuzzy sequential char match
      const fs = this.fuzzyCharScore(token, candidate);
      if (fs === 0) return 0; // token didn't match at all — reject node
      total += fs;
    }
    return total;
  }

  /** Sequential character matching. Returns 0 if not all chars found in order. */
  private fuzzyCharScore(pattern: string, text: string): number {
    let pi = 0;
    let consecutive = 0;
    let maxConsecutive = 0;
    let boundaryHits = 0;

    for (let ti = 0; ti < text.length && pi < pattern.length; ti++) {
      if (text[ti] === pattern[pi]) {
        // Check if this is a word boundary position
        if (ti === 0 || '/- _.'.includes(text[ti - 1])) boundaryHits++;
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
        pi++;
      } else {
        consecutive = 0;
      }
    }
    if (pi < pattern.length) return 0; // not all chars matched
    // Score: base + bonus for consecutive runs + boundary hits
    return 10 + maxConsecutive * 3 + boundaryHits * 5;
  }

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
    const colors = this.kindColors();
    const groups: { category: NodeCategory; label: string; items: { kind: NodeKind; color: string; count: number }[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = Object.entries(byKind)
        .filter(([kind]) => getCategory(kind as NodeKind) === cat)
        .map(([kind, count]) => ({
          kind: kind as NodeKind,
          color: colors[kind as NodeKind] ?? '#888',
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
    this.dataModeService.refreshAvailability();
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

    // Update node + edge brightness (we handle all dimming via color callbacks)
    this.graphLayout.setActiveNodes(this.activeNodeIds(), this.selectedEdges());
    this.graphLayout.focusNode(node.id);
  }

  clearSelection(): void {
    this.collapsePods();
    this.selectedNode.set(null);
    this.selectedEdges.set([]);
    this.connectedNodes.set([]);
    this.selectedKind.set(null);
    this.searchText.set('');
    this.searchOpen.set(false);
    this.graphLayout.setActiveNodes(null);
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

  onNamespaceChipClick(ns: string): void {
    if (this.focusedNamespace() === ns) {
      this.clearNamespaceFocus();
    } else {
      this.focusNamespace(ns);
    }
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
    this.searchText.set('');
    this.searchOpen.set(false);
    this.clearSelection();
    this.graphLayout.fitView();
  }

  fitView(): void {
    this.graphLayout.fitView();
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  onModeChanged(): void {
    this.kindColors.set(getThemedKindColors());
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

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.searchHighlightIndex.set(-1);
    this.searchOpen.set(!!value);
  }

  onSearchKeydown(event: KeyboardEvent): void {
    const results = this.searchResults();
    if (!results.length) return;
    const idx = this.searchHighlightIndex();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(idx + 1, results.length - 1);
      this.searchHighlightIndex.set(next);
      this.selectNode(results[next]);
      this.graphLayout.zoomToNode(results[next].id);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(idx - 1, 0);
      this.searchHighlightIndex.set(prev);
      this.selectNode(results[prev]);
      this.graphLayout.zoomToNode(results[prev].id);
    } else if (event.key === 'Enter' && idx >= 0 && idx < results.length) {
      event.preventDefault();
      this.selectSearchResult(results[idx]);
    }
  }

  selectSearchResult(node: GraphNode): void {
    this.searchOpen.set(false);
    this.searchHighlightIndex.set(-1);
    this.selectNode(node);
    this.graphLayout.zoomToNode(node.id);
  }

  // Global search methods
  openGlobalSearch(): void {
    this.globalSearchOpen.set(true);
    this.globalSearchText.set('');
    this.globalSearchIndex.set(-1);
    setTimeout(() => this.globalSearchInputRef?.nativeElement?.focus());
  }

  closeGlobalSearch(): void {
    this.globalSearchOpen.set(false);
    this.globalSearchText.set('');
    this.globalSearchIndex.set(-1);
  }

  onGlobalSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.globalSearchText.set(value);
    this.globalSearchIndex.set(-1);
  }

  onGlobalSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeGlobalSearch();
      return;
    }
    const results = this.globalSearchResults();
    if (!results.length) return;
    const idx = this.globalSearchIndex();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.globalSearchIndex.set(Math.min(idx + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.globalSearchIndex.set(Math.max(idx - 1, 0));
    } else if (event.key === 'Enter' && idx >= 0 && idx < results.length) {
      event.preventDefault();
      this.selectGlobalResult(results[idx]);
    }
  }

  selectGlobalResult(node: GraphNode): void {
    this.closeGlobalSearch();
    const currentNs = this.focusedNamespace();
    if (currentNs !== node.namespace) {
      this.focusNamespace(node.namespace);
    }
    this.selectNode(node);
    this.graphLayout.zoomToNode(node.id);
  }

  selectKind(kind: NodeKind): void {
    if (this.selectedKind() === kind) {
      // Toggle off
      this.selectedKind.set(null);
      this.selectedNode.set(null);
      this.graphLayout.setActiveNodes(null);
      this.graphLayout.unselectNodes();
      return;
    }
    this.selectedKind.set(kind);
    this.selectedNode.set(null);
    const ids = this.graphData.nodes()
      .filter((n) => n.kind === kind)
      .map((n) => n.id);
    const idSet = new Set(ids);
    // For kind filter, show all edges between nodes of this kind
    const kindEdges = this.graphData.edges().filter(e => idSet.has(e.source) || idSet.has(e.target));
    this.graphLayout.setActiveNodes(idSet, kindEdges);
  }

  getKindColor(kind: NodeKind): string {
    return this.kindColors()[kind] ?? '#888';
  }

  getPodStatusColor(pod: GraphNode): string {
    const status = (pod.metadata?.['status'] as PodPhase) ?? PodPhase.Unknown;
    return POD_STATUS_COLORS[status] ?? '#e07070';
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Cmd+K opens global search (always, even from inputs)
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.openGlobalSearch();
      return;
    }

    const inInput = event.target instanceof HTMLInputElement;

    if (event.key === 'Escape') {
      if (this.globalSearchOpen()) {
        this.closeGlobalSearch();
        return;
      }
      if (inInput) {
        if (this.searchOpen()) {
          this.searchOpen.set(false);
        } else {
          this.searchText.set('');
          this.searchOpen.set(false);
          (event.target as HTMLInputElement).blur();
        }
        return;
      }
      if (this.selectedNode() || this.selectedKind()) {
        this.clearSelection();
      } else if (this.focusedNamespace()) {
        this.clearNamespaceFocus();
      }
    }
    if (inInput) return;
    if (event.key === 'f' || event.key === 'F') {
      if (!this.selectedNode()) {
        this.fitView();
      }
    }
    if (event.key === '/' && this.focusedNamespace()) {
      event.preventDefault();
      this.searchInputRef?.nativeElement?.focus();
    }
  }
}
