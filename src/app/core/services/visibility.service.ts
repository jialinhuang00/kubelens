import { Injectable, inject, signal } from '@angular/core';
import { ConfigService, kindId } from './config.service';

export type ViewName = 'tree' | 'graph';

/**
 * Per-user visibility overrides for resource kinds, persisted to localStorage.
 * Keyed by "group/Kind" (not Kind alone) so two CRDs sharing a Kind name — e.g.
 * Gateway in gateway.networking.k8s.io vs networking.istio.io — toggle
 * independently. Toggling only changes what's rendered; it does not re-query the
 * cluster (the tree/graph filter their already-loaded data).
 */
@Injectable({ providedIn: 'root' })
export class VisibilityService {
  private config = inject(ConfigService);
  private readonly KEY = 'kubelens.visibility';

  // { [group/Kind]: { tree?: boolean, graph?: boolean } } — absent = config default.
  overrides = signal<Record<string, Partial<Record<ViewName, boolean>>>>(this.load());

  private load(): Record<string, Partial<Record<ViewName, boolean>>> {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.overrides()));
    } catch {
      /* localStorage unavailable — keep in-memory only */
    }
  }

  /** Config default: is this kind declared for this view in kubelens.config.yaml? */
  private configDefault(id: string, view: ViewName): boolean {
    return this.config.resources().find(r => kindId(r.group, r.kind) === id)?.show?.includes(view) ?? false;
  }

  isVisible(id: string, view: ViewName): boolean {
    return this.overrides()[id]?.[view] ?? this.configDefault(id, view);
  }

  set(id: string, view: ViewName, value: boolean): void {
    this.overrides.update(o => ({ ...o, [id]: { ...o[id], [view]: value } }));
    this.persist();
  }

  toggle(id: string, view: ViewName): void {
    this.set(id, view, !this.isVisible(id, view));
  }

  /** Drop all overrides — back to config defaults. */
  reset(): void {
    this.overrides.set({});
    this.persist();
  }
}
