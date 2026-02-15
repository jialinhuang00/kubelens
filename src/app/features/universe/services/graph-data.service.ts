import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { GraphDataResponse, GraphNode, GraphEdge } from '../models/graph.models';

@Injectable({ providedIn: 'root' })
export class GraphDataService {
  private readonly http = inject(HttpClient);
  private readonly _data = signal<GraphDataResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly data = this._data.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly nodes = computed(() => this._data()?.nodes ?? []);
  readonly edges = computed(() => this._data()?.edges ?? []);
  readonly stats = computed(() => this._data()?.stats ?? null);
  readonly pods = computed(() => this._data()?.pods ?? {});

  fetchGraph(): void {
    this._loading.set(true);
    this._error.set(null);

    this.http.get<GraphDataResponse>('http://localhost:3000/api/graph').subscribe({
      next: (data) => {
        this._data.set(data);
        this._loading.set(false);
      },
      error: (err) => {
        this._error.set(err.message || 'Failed to load graph data');
        this._loading.set(false);
      },
    });
  }

  getNodeById(id: string): GraphNode | undefined {
    return this.nodes().find((n) => n.id === id);
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
