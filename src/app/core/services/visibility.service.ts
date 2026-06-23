import { Injectable, inject, signal } from '@angular/core';
import { ConfigService } from './config.service';

export type ViewName = 'tree' | 'graph';

/**
 * Per-user visibility overrides for resource kinds, persisted to localStorage.
 * Layered on top of config: config.show is the default, the user toggles per
 * kind/view at runtime. Toggling only changes what's rendered (the tree/graph
 * filter their already-loaded data), it does not re-query the cluster.
 */
@Injectable({ providedIn: 'root' })
export class VisibilityService {
  private config = inject(ConfigService);
  private readonly KEY = 'kubelens.visibility';

  // { [kind]: { tree?: boolean, graph?: boolean } } — absent means "use config default".
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
  private configDefault(kind: string, view: ViewName): boolean {
    return this.config.resources().find(r => r.kind === kind)?.show?.includes(view) ?? false;
  }

  isVisible(kind: string, view: ViewName): boolean {
    return this.overrides()[kind]?.[view] ?? this.configDefault(kind, view);
  }

  toggle(kind: string, view: ViewName): void {
    const next = !this.isVisible(kind, view);
    this.overrides.update(o => ({ ...o, [kind]: { ...o[kind], [view]: next } }));
    this.persist();
  }

  /** Drop all overrides — back to config defaults. */
  reset(): void {
    this.overrides.set({});
    this.persist();
  }
}
