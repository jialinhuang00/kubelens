import { Injectable, NgZone, inject } from '@angular/core';
import { Graph, CosmosInputNode, CosmosInputLink } from '@cosmograph/cosmos';
import {
  GraphDataResponse,
  GraphNode,
  GraphEdge,
  KIND_COLORS,
  CATEGORY_SIZES,
  getCategory,
  getThemedKindColors,
  getThemedEdgeColors,
  NodeKind,
  EdgeType,
} from '../models/graph.models';

export interface CosmosNode extends CosmosInputNode {
  id: string;
  x?: number;
  y?: number;
  data: GraphNode;
}

export interface CosmosLink extends CosmosInputLink {
  source: string;
  target: string;
  data: GraphEdge;
}

export interface NodeLabel {
  id: string;
  text: string;
  kind: NodeKind;
  color: string;
  x: number;
  y: number;
  size: number; // node size for orb rendering
  orphan: boolean;
}

export interface NamespaceBoundary {
  namespace: string;
  color: string;
  cx: number;  // center x (screen)
  cy: number;  // center y (screen)
  rx: number;  // radius x
  ry: number;  // radius y
}

export interface GraphCallbacks {
  onNodeHover: (node: GraphNode | null, position: [number, number] | null) => void;
  onNodeClick: (node: GraphNode | null) => void;
  onZoom: (level: number) => void;
  onLabelsUpdate: (labels: NodeLabel[], boundaries: NamespaceBoundary[]) => void;
}

@Injectable({ providedIn: 'root' })
export class GraphLayoutService {
  private readonly ngZone = inject(NgZone);
  private graph: Graph<CosmosNode, CosmosLink> | null = null;
  private cosmosNodes: CosmosNode[] = [];
  private cosmosLinks: CosmosLink[] = [];
  private nodeIndexMap = new Map<string, number>();
  private labelRafId: number | null = null;
  private callbacks: GraphCallbacks | null = null;
  private temporaryNodeIds = new Set<string>();
  private baseNodeCount = 0; // node count before temporary pods
  private currentKindColors: Record<NodeKind, string> = KIND_COLORS;
  private activeNodeIds: Set<string> | null = null; // null = no selection, show all
  private activeEdgeKeys: Set<string> | null = null; // null = no selection, show all

  initializeGraph(
    canvas: HTMLCanvasElement,
    data: GraphDataResponse,
    callbacks: GraphCallbacks
  ): void {
    this.destroy();
    this.buildCosmosData(data);
    this.callbacks = callbacks;

    // For large graphs, disable simulation — rely on preset positions from buildCosmosData
    const nodeCount = this.cosmosNodes.length;
    const isLarge = nodeCount > 200;

    // Read themed colors from CSS tokens at init time
    this.currentKindColors = getThemedKindColors();
    const kindColors = this.currentKindColors;
    const edgeColors = getThemedEdgeColors();

    this.ngZone.runOutsideAngular(() => {
      this.graph = new Graph<CosmosNode, CosmosLink>(canvas, {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        nodeColor: (n) => {
          const base = kindColors[n.data.kind] ?? '#888';
          if (!this.activeNodeIds) return base;
          if (this.activeNodeIds.has(n.data.id)) return base;
          const r = parseInt(base.slice(1, 3), 16);
          const g = parseInt(base.slice(3, 5), 16);
          const b = parseInt(base.slice(5, 7), 16);
          return `rgba(${r},${g},${b},0.08)`;
        },
        nodeSize: (n) => n.data.kind === 'Pod' ? 3 : (CATEGORY_SIZES[getCategory(n.data.kind)] ?? 5),
        nodeSizeScale: 1,
        linkColor: (l) => {
          const base = edgeColors[l.data.type] ?? '#556677';
          if (!this.activeEdgeKeys) return base;
          const key = `${l.data.source}|${l.data.target}`;
          if (this.activeEdgeKeys.has(key)) return base;
          const r = parseInt(base.slice(1, 3), 16);
          const g = parseInt(base.slice(3, 5), 16);
          const b = parseInt(base.slice(5, 7), 16);
          return `rgba(${r},${g},${b},0.06)`;
        },
        linkWidth: (l) => {
          const t = l.data.type;
          if (t === EdgeType.Exposes || t === EdgeType.RoutesTo || t === EdgeType.ParentGateway) return 1.5;
          return 3;
        },
        linkArrows: true,
        linkArrowsSizeScale: 0.8,
        curvedLinks: true,
        curvedLinkWeight: 0.6,
        linkVisibilityDistanceRange: isLarge ? [50, 1200] : [80, 400],
        linkVisibilityMinTransparency: 0.4,
        scaleNodesOnZoom: true,
        fitViewOnInit: true,
        fitViewDelay: isLarge ? 800 : 500,
        nodeGreyoutOpacity: 1.0,
        linkGreyoutOpacity: 1.0,
        hoveredNodeRingColor: '#ffffff',
        focusedNodeRingColor: getComputedStyle(document.documentElement).getPropertyValue('--t-accent').trim() || '#e8b866',
        randomSeed: 42,
        disableSimulation: isLarge,
        simulation: {
          gravity: 0.25,
          center: 0.35,
          repulsion: 1.0,
          linkSpring: 0.8,
          linkDistance: 10,
          friction: 0.85,
          decay: isLarge ? 0 : 2000,
        },
        events: {
          onNodeMouseOver: (node, _index, position) => {
            canvas.style.cursor = 'pointer';
            this.ngZone.run(() => {
              callbacks.onNodeHover(node?.data ?? null, position ?? null);
            });
          },
          onNodeMouseOut: () => {
            canvas.style.cursor = 'default';
            this.ngZone.run(() => {
              callbacks.onNodeHover(null, null);
            });
          },
          onClick: (node) => {
            this.ngZone.run(() => {
              callbacks.onNodeClick(node?.data ?? null);
            });
          },
          onZoom: (e) => {
            this.ngZone.run(() => {
              callbacks.onZoom(e.transform?.k ?? 1);
            });
          },
        },
      });

      this.graph.setData(this.cosmosNodes, this.cosmosLinks);
      this.startLabelLoop();
    });
  }

  private startLabelLoop(): void {
    let frameCount = 0;
    const loop = () => {
      this.labelRafId = requestAnimationFrame(loop);
      // Throttle: update labels every 3 frames (~20fps) for performance
      frameCount++;
      if (frameCount % 3 !== 0) return;
      this.updateLabels();
    };
    this.labelRafId = requestAnimationFrame(loop);
  }

  private updateLabels(): void {
    if (!this.graph || !this.callbacks) return;
    const positions = this.graph.getNodePositionsMap();
    if (positions.size === 0) {
      console.warn('[GraphLayout] getNodePositionsMap returned empty map, cosmosNodes:', this.cosmosNodes.length);
      return;
    }
    const labels: NodeLabel[] = [];

    // Collect screen positions per namespace for boundary calculation
    const nsPositions = new Map<string, { xs: number[]; ys: number[]; color: string }>();

    for (const node of this.cosmosNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const screenPos = this.graph.spaceToScreenPosition(pos);
      // Skip labels off-screen (with some margin)
      if (screenPos[0] < -100 || screenPos[0] > window.innerWidth + 100) continue;
      if (screenPos[1] < -100 || screenPos[1] > window.innerHeight + 100) continue;

      labels.push({
        id: node.id,
        text: node.data.name,
        kind: node.data.kind,
        color: this.currentKindColors[node.data.kind] ?? '#888',
        x: screenPos[0],
        y: screenPos[1],
        size: CATEGORY_SIZES[getCategory(node.data.kind)] ?? 5,
        orphan: !!node.data.metadata?.['orphan'],
      });

      // Accumulate positions for namespace boundaries
      const ns = node.data.namespace;
      if (ns) {
        let entry = nsPositions.get(ns);
        if (!entry) {
          // Use namespace node color if available
          const nsColor = this.currentKindColors['Namespace'];
          entry = { xs: [], ys: [], color: nsColor };
          nsPositions.set(ns, entry);
        }
        entry.xs.push(screenPos[0]);
        entry.ys.push(screenPos[1]);
      }
    }

    // Calculate namespace boundaries (bounding ellipse)
    const boundaries: NamespaceBoundary[] = [];
    for (const [namespace, data] of nsPositions) {
      if (data.xs.length < 2) continue; // need at least 2 nodes
      const minX = Math.min(...data.xs);
      const maxX = Math.max(...data.xs);
      const minY = Math.min(...data.ys);
      const maxY = Math.max(...data.ys);
      const padding = 60;
      boundaries.push({
        namespace,
        color: data.color,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        rx: (maxX - minX) / 2 + padding,
        ry: (maxY - minY) / 2 + padding,
      });
    }

    this.ngZone.run(() => {
      this.callbacks!.onLabelsUpdate(labels, boundaries);
    });
  }

  private buildCosmosData(data: GraphDataResponse): void {
    this.cosmosNodes = [];
    this.cosmosLinks = [];
    this.nodeIndexMap.clear();

    // Group nodes by namespace
    const nsGroups = new Map<string, GraphNode[]>();
    for (const node of data.nodes) {
      const ns = node.namespace || '_default';
      let group = nsGroups.get(ns);
      if (!group) {
        group = [];
        nsGroups.set(ns, group);
      }
      group.push(node);
    }

    const nsCount = nsGroups.size;

    // Calculate namespace center positions in a grid layout
    const nsCenters = new Map<string, { cx: number; cy: number }>();
    if (nsCount <= 1) {
      // Single namespace: center at origin
      for (const ns of nsGroups.keys()) {
        nsCenters.set(ns, { cx: 0, cy: 0 });
      }
    } else {
      // Arrange namespaces in a large circle
      const nsRadius = Math.max(400, nsCount * 80);
      const sortedNs = [...nsGroups.keys()].sort();
      for (let i = 0; i < sortedNs.length; i++) {
        const angle = (2 * Math.PI * i) / sortedNs.length - Math.PI / 2;
        nsCenters.set(sortedNs[i], {
          cx: nsRadius * Math.cos(angle),
          cy: nsRadius * Math.sin(angle),
        });
      }
    }

    // Category ring radii within each namespace cluster
    const categoryRadii: Record<string, number> = {
      workload: 40,
      abstract: 90,
      storage: 130,
      rbac: 150,
    };
    const orphanRadius = 170;

    let idx = 0;
    for (const [ns, nsNodes] of nsGroups) {
      const center = nsCenters.get(ns) ?? { cx: 0, cy: 0 };

      const catGroups: Record<string, GraphNode[]> = {};
      const orphanNodes: GraphNode[] = [];

      for (const node of nsNodes) {
        if (node.metadata?.['orphan']) {
          orphanNodes.push(node);
        } else {
          const cat = getCategory(node.kind);
          if (!catGroups[cat]) catGroups[cat] = [];
          catGroups[cat].push(node);
        }
      }

      for (const [cat, nodes] of Object.entries(catGroups)) {
        const radius = categoryRadii[cat] ?? 100;
        const count = nodes.length;
        for (let i = 0; i < count; i++) {
          const angle = (2 * Math.PI * i) / Math.max(count, 1);
          const jitter = (Math.random() - 0.5) * 15;
          const r = radius + jitter;
          const cosmosNode: CosmosNode = {
            id: nodes[i].id,
            x: center.cx + r * Math.cos(angle),
            y: center.cy + r * Math.sin(angle),
            data: nodes[i],
          };
          this.cosmosNodes.push(cosmosNode);
          this.nodeIndexMap.set(cosmosNode.id, idx);
          idx++;
        }
      }

      if (orphanNodes.length > 0) {
        for (let i = 0; i < orphanNodes.length; i++) {
          const angle = (2 * Math.PI * i) / orphanNodes.length;
          const jitter = (Math.random() - 0.5) * 10;
          const r = orphanRadius + jitter;
          const cosmosNode: CosmosNode = {
            id: orphanNodes[i].id,
            x: center.cx + r * Math.cos(angle),
            y: center.cy + r * Math.sin(angle),
            data: orphanNodes[i],
          };
          this.cosmosNodes.push(cosmosNode);
          this.nodeIndexMap.set(cosmosNode.id, idx);
          idx++;
        }
      }
    }

    // Build links (only for nodes that exist)
    for (const edge of data.edges) {
      if (this.nodeIndexMap.has(edge.source) && this.nodeIndexMap.has(edge.target)) {
        this.cosmosLinks.push({
          source: edge.source,
          target: edge.target,
          data: edge,
        });
      }
    }
  }

  selectNode(nodeId: string): void {
    // No-op for cosmos selection — we handle highlighting via color callbacks
  }

  selectNodesByIds(ids: string[]): void {
    // No-op for cosmos selection — we handle highlighting via color callbacks
  }

  /** Set which nodes/edges should appear bright; null = show all */
  setActiveNodes(nodeIds: Set<string> | null, edges?: GraphEdge[]): void {
    this.activeNodeIds = nodeIds;
    this.activeEdgeKeys = edges ? new Set(edges.map(e => `${e.source}|${e.target}`)) : null;
    if (!this.graph) return;
    const kindColors = this.currentKindColors;
    const edgeColors = getThemedEdgeColors();
    this.graph.setConfig({
      nodeColor: (n) => {
        const base = kindColors[n.data.kind] ?? '#888';
        if (!this.activeNodeIds) return base;
        if (this.activeNodeIds.has(n.data.id)) return base;
        const r = parseInt(base.slice(1, 3), 16);
        const g = parseInt(base.slice(3, 5), 16);
        const b = parseInt(base.slice(5, 7), 16);
        return `rgba(${r},${g},${b},0.08)`;
      },
      linkColor: (l) => {
        const base = edgeColors[l.data.type] ?? '#556677';
        if (!this.activeEdgeKeys) return base;
        const key = `${l.data.source}|${l.data.target}`;
        if (this.activeEdgeKeys.has(key)) return base;
        const r = parseInt(base.slice(1, 3), 16);
        const g = parseInt(base.slice(3, 5), 16);
        const b = parseInt(base.slice(5, 7), 16);
        return `rgba(${r},${g},${b},0.06)`;
      },
    });
  }

  unselectNodes(): void {
    if (!this.graph) return;
    this.activeNodeIds = null;
    this.activeEdgeKeys = null;
    this.graph.unselectNodes();
    const kindColors = this.currentKindColors;
    const edgeColors = getThemedEdgeColors();
    this.graph.setConfig({
      nodeColor: (n) => kindColors[n.data.kind] ?? '#888',
      linkColor: (l) => edgeColors[l.data.type] ?? '#556677',
    });
  }

  focusNode(nodeId: string): void {
    if (!this.graph) return;
    this.graph.setFocusedNodeById(nodeId);
  }

  unfocusNode(): void {
    if (!this.graph) return;
    this.graph.setFocusedNodeById(undefined);
  }

  zoomToNode(nodeId: string): void {
    if (!this.graph) return;
    this.graph.zoomToNodeById(nodeId, 700, 3);
  }

  fitView(): void {
    if (!this.graph) return;
    this.graph.fitView(500);
  }

  /** Hide WebGL dots (DOM orbs take over) */
  setNodesTransparent(): void {
    if (!this.graph) return;
    this.graph.setConfig({ nodeColor: () => 'rgba(0,0,0,0)' });
  }

  /** Show WebGL dots (overview mode) */
  setNodesVisible(): void {
    if (!this.graph) return;
    this.graph.setConfig({ nodeColor: (n) => this.currentKindColors[n.data.kind] ?? '#888' });
  }

  spaceToScreen(pos: [number, number]): [number, number] {
    return this.graph?.spaceToScreenPosition(pos) ?? pos;
  }

  /** Get the space position of a node by ID */
  getNodePosition(nodeId: string): [number, number] | null {
    if (!this.graph) return null;
    const positions = this.graph.getNodePositionsMap();
    return positions.get(nodeId) ?? null;
  }

  /** Add temporary pod nodes around a parent workload node */
  addTemporaryNodes(parentId: string, podNodes: GraphNode[]): void {
    if (!this.graph || podNodes.length === 0) return;

    // Remove any existing temporary nodes first
    this.removeTemporaryNodes();

    // Save base count so we know what to revert to
    this.baseNodeCount = this.cosmosNodes.length;

    // Get parent node's position in graph space
    const parentPos = this.getNodePosition(parentId);
    if (!parentPos) return;

    const [px, py] = parentPos;
    const podRadius = 20; // distance from parent in graph space

    let idx = this.cosmosNodes.length;
    for (let i = 0; i < podNodes.length; i++) {
      const angle = (2 * Math.PI * i) / podNodes.length - Math.PI / 2;
      const cosmosNode: CosmosNode = {
        id: podNodes[i].id,
        x: px + podRadius * Math.cos(angle),
        y: py + podRadius * Math.sin(angle),
        data: podNodes[i],
      };
      this.cosmosNodes.push(cosmosNode);
      this.nodeIndexMap.set(cosmosNode.id, idx);
      this.temporaryNodeIds.add(cosmosNode.id);
      idx++;

      // Add "owns" edge from parent to pod
      this.cosmosLinks.push({
        source: parentId,
        target: podNodes[i].id,
        data: { source: parentId, target: podNodes[i].id, type: EdgeType.Owns },
      });
    }

    // Re-feed data to cosmos
    this.graph.setData(this.cosmosNodes, this.cosmosLinks);
  }

  /** Remove all temporary pod nodes */
  removeTemporaryNodes(): void {
    if (this.temporaryNodeIds.size === 0) return;

    // Filter out temporary nodes and links
    this.cosmosNodes = this.cosmosNodes.filter(n => !this.temporaryNodeIds.has(n.id));
    this.cosmosLinks = this.cosmosLinks.filter(
      l => !this.temporaryNodeIds.has(l.source as string) && !this.temporaryNodeIds.has(l.target as string)
    );

    // Rebuild index map
    this.nodeIndexMap.clear();
    for (let i = 0; i < this.cosmosNodes.length; i++) {
      this.nodeIndexMap.set(this.cosmosNodes[i].id, i);
    }

    this.temporaryNodeIds.clear();

    // Re-feed data to cosmos
    if (this.graph) {
      this.graph.setData(this.cosmosNodes, this.cosmosLinks);
    }
  }

  /** Check if a node is a temporary pod */
  isTemporaryNode(nodeId: string): boolean {
    return this.temporaryNodeIds.has(nodeId);
  }

  destroy(): void {
    if (this.labelRafId !== null) {
      cancelAnimationFrame(this.labelRafId);
      this.labelRafId = null;
    }
    if (this.graph) {
      this.graph.destroy();
      this.graph = null;
    }
    this.cosmosNodes = [];
    this.cosmosLinks = [];
    this.nodeIndexMap.clear();
    this.temporaryNodeIds.clear();
    this.baseNodeCount = 0;
    this.callbacks = null;
  }
}
