import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { GraphDataResponse, GraphNode, GraphEdge } from '../models/graph.models';
import { API_BASE } from '../../../core/constants/api';

@Injectable({ providedIn: 'root' })
export class GraphDataService {
  private readonly http = inject(HttpClient);
  private readonly _data = signal<GraphDataResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private inflight: Subscription | null = null;

  readonly data = this._data.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly nodes      = computed(() => this._data()?.nodes      ?? []);
  readonly edges      = computed(() => this._data()?.edges      ?? []);
  readonly stats      = computed(() => this._data()?.stats      ?? null);
  readonly pods       = computed(() => this._data()?.pods       ?? {});
  readonly namespaces = computed(() => this._data()?.namespaces ?? []);

  fetchGraph(forceSnapshot = false): void {
    // Cancel previous in-flight request (server detects client disconnect)
    this.inflight?.unsubscribe();

    this._loading.set(true);
    this._error.set(null);

    const url = forceSnapshot ? `${API_BASE}/graph?snapshot=true` : `${API_BASE}/graph`;
    this.inflight = this.http.get<GraphDataResponse>(url).subscribe({
      next: (data) => {
        this._data.set(data);
        this._loading.set(false);
      },
      error: (err: any) => {
        const body = typeof err?.error === 'object' ? err.error : null;
        const message = body?.message || body?.error || err?.message || 'Failed to load graph data';
        console.error('[graph-data] Error response:', err);
        this._error.set(message);
        this._loading.set(false);
      },
    });
  }

  getConnectedEdges(nodeId: string): GraphEdge[] {
    return this.edges().filter((e) => e.source === nodeId || e.target === nodeId);
  }

  getPodsForWorkload(nodeId: string): GraphNode[] {
    return this.pods()[nodeId] ?? [];
  }

  getConnectedNodes(nodeId: string): GraphNode[] {
    const connectedEdges = this.getConnectedEdges(nodeId);
    const connectedIds = new Set<string>();
    for (const e of connectedEdges) {
      if (e.source !== nodeId) connectedIds.add(e.source);
      if (e.target !== nodeId) connectedIds.add(e.target);
    }
    return this.nodes().filter((n) => connectedIds.has(n.id));
  }
}
