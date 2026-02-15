# Universe Component — WebGL Rendering Architecture

## Overview

This feature renders a K8s resource graph using **two rendering layers**:

```
┌─────────────────────────────────────────────┐
│  z:10  Top bar / Panels (HTML)              │
│  z:6   Vignette overlay (CSS)               │
│  z:5   Node labels + orbs (HTML DOM)        │  ← Angular renders
│  z:4   Scanlines (CSS)                      │
│  z:2   Namespace boundaries (HTML DOM)      │  ← Angular renders
│  z:1   Graph canvas (WebGL)                 │  ← Cosmos renders
│  z:0   Grid floor / Nebula (CSS)            │
└─────────────────────────────────────────────┘
```

- **WebGL layer** (`<canvas>`) — Cosmos renders nodes as GPU particles + link lines
- **DOM layer** (`.labels-overlay`) — Angular renders labels, orbs, boundaries as HTML

## 1. WebGL Needs a Canvas

Yes. WebGL always renders into a `<canvas>` element.

```
universe.component.html:50
─────────────────────────
<canvas #graphCanvas class="graph-canvas"></canvas>
```

```
universe.component.ts:38
────────────────────────
@ViewChild('graphCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
```

Cosmos internally calls `canvas.getContext('webgl')` and creates a **regl** instance (a WebGL wrapper). All node/link rendering happens via GPU shaders — this is why 600+ nodes render without lag on the canvas.

### Initialization flow

```
ngOnInit()           → fetchGraph()           // HTTP GET /api/graph
ngAfterViewInit()    → poll until data ready
                     → initGraph(data)
                     → graphLayout.initializeGraph(canvas, data, callbacks)
```

```
graph-layout.service.ts:64-137
──────────────────────────────
initializeGraph(canvas, data, callbacks):
  1. buildCosmosData(data)          // Convert API data → Cosmos format + calculate x,y positions
  2. new Graph(canvas, config)      // Cosmos creates WebGL context on this canvas
  3. graph.setData(nodes, links)    // Upload node/link data to GPU
  4. startLabelLoop()               // Start RAF loop for HTML label positions
```

## 2. How Cosmos Uses WebGL

Cosmos uses **regl** (a functional WebGL library). Under the hood:

### Node Rendering
- Each node is a **point sprite** rendered by a vertex shader
- Node positions are stored in a **WebGL framebuffer texture** (FBO)
- The GPU reads positions from this texture every frame → no CPU bottleneck
- `nodeColor`, `nodeSize` functions are evaluated once and uploaded as buffer attributes

### Link Rendering
- Links are drawn as **instanced line segments** (or curved quads)
- Source/target positions are looked up from the same position FBO
- `linkColor`, `linkWidth` configure the fragment shader

### Force Simulation (small graphs, < 200 nodes)
- Physics simulation runs **on the GPU** via shader programs
- Gravity, repulsion, spring forces are computed in parallel per-node
- Position FBO is updated each frame until `decay` timer expires

### Pre-calculated Layout (large graphs, > 200 nodes)
- `disableSimulation: true` — skip GPU physics
- Positions are pre-calculated in `buildCosmosData()` (CPU-side)
- Nodes arranged: namespaces in a circle → categories in concentric rings

```
graph-layout.service.ts:216-332  → buildCosmosData()
```

## 3. Zoom, Pan, Hover — How They Work

All handled by Cosmos internally via **d3-zoom** on the canvas element.

### Zoom & Pan

Cosmos attaches a d3-zoom behavior to the `<canvas>`:
- **Scroll wheel** → zoom (d3-zoom transform `k` value)
- **Click + drag** → pan (d3-zoom transform `x, y` values)
- The zoom transform is applied in the vertex shader — the GPU transforms all node positions in one pass

```
config.events.onZoom (graph-layout.service.ts:127-130)
─────────────────────
onZoom: (e) => {
  callbacks.onZoom(e.transform?.k ?? 1);  // k = zoom level (1.0 = default)
}
```

The component receives the zoom level and displays it:
```
universe.component.ts:54  → zoomLevel signal
universe.component.html:94 → {{ zoomLevel() | number:'1.1-1' }}x
```

### Hover Detection

Cosmos performs **GPU-based hit testing**:
1. Renders nodes to an off-screen framebuffer with unique colors per node (color picking)
2. On mousemove, reads the pixel under the cursor from this framebuffer
3. Maps the color back to a node index → identifies which node is hovered

This is O(1) regardless of node count — no spatial indexing needed.

```
config.events.onNodeMouseOver (graph-layout.service.ts:110-115)
───────────────────────────────
onNodeMouseOver: (node, _index, position) => {
  canvas.style.cursor = 'pointer';
  callbacks.onNodeHover(node?.data ?? null, position ?? null);
}
```

The component shows a tooltip at the screen position:
```
universe.component.ts:45-46  → hoveredNode, tooltipPosition signals
universe.component.html:98-106 → tooltip div positioned via [style.left.px]
```

### Click → Selection

Same GPU picking as hover. On click:

```
config.events.onClick (graph-layout.service.ts:122-126)
────────────────────────
onClick: (node) => {
  callbacks.onNodeClick(node?.data ?? null);
}
```

The component highlights the node and shows connected edges:
```
universe.component.ts:221-227  → selectNode()
  graph.selectNodeById()       → Cosmos highlights node, greys out others
  graph.setFocusedNodeById()   → Cosmos draws focus ring
```

### Programmatic Navigation

```
graph-layout.service.ts
───────────────────────
zoomToNode(id)         → graph.zoomToNodeById(id, duration, zoomLevel)
fitView()              → graph.fitView(duration)
selectNodesByIds(ids)  → graph.selectNodesByIds(ids)  // highlight subset
setNodesTransparent()  → graph.setConfig({ nodeColor: ... })  // hide WebGL dots
setNodesVisible()      → graph.setConfig({ nodeColor: ... })  // show WebGL dots
```

## 4. Coordinate Systems

Two coordinate spaces:

| Space | Description | Example |
|-------|-------------|---------|
| **Graph space** | Node positions in simulation units | `(1200, -800)` |
| **Screen space** | Pixel position on viewport | `(650, 400)` |

Conversion:
```
graph-layout.service.ts:379-381
───────────────────────────────
spaceToScreen(pos) → graph.spaceToScreenPosition(pos)
```

Used in the label loop to position HTML labels on top of WebGL nodes:
```
graph-layout.service.ts:152-213  → updateLabels()
  graph.getNodePositionsMap()     // Read positions from GPU framebuffer
  graph.spaceToScreenPosition()   // Convert to screen pixels
  → callback updates Angular signals → template renders labels
```

## 5. The Two-Layer Rendering Strategy

### Why not just WebGL?
WebGL renders dots — it can't render rich text, CSS effects, or complex interactions.

### Why not just DOM?
612 DOM elements repositioned at 20fps = lag. GPU handles thousands of particles natively.

### Solution: Hybrid

| Mode | WebGL (canvas) | DOM (labels-overlay) |
|------|---------------|---------------------|
| **Overview** (no namespace selected) | Colored dots ✓ | Important labels only (text, no orb) |
| **Focused** (namespace selected) | Transparent | Full orbs + all labels for that namespace |

This keeps DOM element count low (~100-150) while the GPU handles the heavy lifting.

## 6. NgZone Consideration

Cosmos runs outside Angular's zone for performance:

```
graph-layout.service.ts:77
──────────────────────────
this.ngZone.runOutsideAngular(() => {
  this.graph = new Graph(canvas, config);
  ...
});
```

All callbacks must re-enter the zone for Angular change detection:
```
this.ngZone.run(() => {
  callbacks.onNodeHover(...);   // triggers signal update → template re-renders
});
```

Without `ngZone.run()`, signal updates happen but Angular never detects them → DOM doesn't update.

## File Map

```
universe/
├── components/
│   ├── universe.component.ts       # Component logic, signals, event handlers
│   ├── universe.component.html     # Template: canvas + HTML overlays
│   └── universe.component.scss     # Styles: orbs, boundaries, panels
├── services/
│   ├── graph-layout.service.ts     # Cosmos WebGL wrapper, coordinate conversion, labels
│   └── graph-data.service.ts       # HTTP fetch, data signals, node/edge queries
└── models/
    └── graph.models.ts             # Types, color maps, size maps, category logic
```
