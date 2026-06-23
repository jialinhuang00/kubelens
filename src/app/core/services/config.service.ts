import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../constants/api';

export interface ResourceKind {
  kind: string;
  key: string;
  resourceType: string;
  namePrefix: string;
  group: string;
  label: string;
  color: string;
  priority?: boolean;
  show: ('tree' | 'graph')[];
}

/**
 * Loads the resource-kind list from /api/config once at startup. Replaces the
 * RESOURCE_KINDS array and kind maps that were hardcoded in the frontend.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private http = inject(HttpClient);
  resources = signal<ResourceKind[]>([]);
  private loaded?: Promise<ResourceKind[]>;

  constructor() {
    // Warm the cache at startup; callers still await ensureLoaded() before use.
    this.ensureLoaded();
  }

  ensureLoaded(): Promise<ResourceKind[]> {
    if (!this.loaded) {
      this.loaded = firstValueFrom(
        this.http.get<{ resources: ResourceKind[] }>(`${API_BASE}/config`)
      ).then(r => {
        this.resources.set(r.resources);
        return r.resources;
      }).catch(err => {
        console.error('Failed to load /api/config:', err);
        this.loaded = undefined; // allow a later retry
        return [];
      });
    }
    return this.loaded;
  }

  /** Kinds shown in the resource tree, in declared order. */
  treeKinds(): ResourceKind[] {
    return this.resources().filter(r => r.show?.includes('tree'));
  }
}
