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
  show: ('tree' | 'graph')[];      // capability: which views this kind CAN appear in
  default?: ('tree' | 'graph')[];  // default-on views (subset of show); absent = same as show
}

/** A kind discovered from the cluster via kubectl api-resources. */
export interface DiscoveredKind {
  name: string;          // bare resource name, e.g. "virtualservices"
  kind: string;          // Kind, e.g. "VirtualService"
  group: string;         // API group ('' = core)
  resourceType: string;  // kubectl target, e.g. "virtualservices.networking.istio.io"
}

/** Canonical identity for a kind: group + Kind. Unique even when two CRDs share a Kind name. */
export function kindId(group: string, kind: string): string {
  return `${group}/${kind}`;
}

/** Official Kubernetes API groups: core (empty), a few simple names, and everything
 *  under *.k8s.io. Third-party CRDs use their own domain (argoproj.io, *.istio.io, ...). */
const SIMPLE_OFFICIAL_GROUPS = new Set(['apps', 'batch', 'autoscaling', 'policy', 'extensions']);
export function isOfficialGroup(group: string): boolean {
  return group === '' || group.endsWith('.k8s.io') || SIMPLE_OFFICIAL_GROUPS.has(group);
}

/**
 * Loads the resource-kind list from /api/config once at startup. Replaces the
 * RESOURCE_KINDS array and kind maps that were hardcoded in the frontend.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private http = inject(HttpClient);
  resources = signal<ResourceKind[]>([]);
  discovered = signal<DiscoveredKind[]>([]);
  private loaded?: Promise<ResourceKind[]>;
  private discoveredLoaded?: Promise<DiscoveredKind[]>;

  constructor() {
    // Warm the cache at startup; callers still await ensureLoaded() before use.
    this.ensureLoaded();
  }

  /** Lazily fetch the cluster's actual namespaced kinds (for the visibility panel). */
  ensureDiscovered(): Promise<DiscoveredKind[]> {
    if (!this.discoveredLoaded) {
      this.discoveredLoaded = firstValueFrom(
        this.http.get<{ resources: DiscoveredKind[] }>(`${API_BASE}/api-resources`)
      ).then(r => {
        this.discovered.set(r.resources ?? []);
        return r.resources ?? [];
      }).catch(err => {
        console.error('Failed to load /api/api-resources:', err);
        this.discoveredLoaded = undefined;
        return [];
      });
    }
    return this.discoveredLoaded;
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
