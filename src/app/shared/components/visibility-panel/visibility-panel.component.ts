import { Component, computed, inject, signal } from '@angular/core';
import { ConfigService, kindId } from '../../../core/services/config.service';
import { VisibilityService } from '../../../core/services/visibility.service';

interface KindRow {
  id: string;
  kind: string;
  group: string;
  label: string;
  color: string;
}

const DISCOVERED_COLOR = '#8a8a8a';

@Component({
  selector: 'app-visibility-panel',
  standalone: true,
  template: `
    <div class="vis-wrap">
      <button class="vis-btn" (click)="onOpen()" title="Resource visibility">
        <svg width="15" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/>
        </svg>
      </button>

      @if (open()) {
        <div class="overlay" (click)="onOverlayClick($event)">
          <div class="panel" (click)="$event.stopPropagation()">
            <div class="panel-topbar">
              <span class="panel-title">Resource Visibility</span>
              <button class="close-btn" (click)="open.set(false)">✕</button>
            </div>
            <div class="panel-hint">Pick which kinds show in the sidebar tree. Detected from your cluster; saved in your browser.</div>

            <div class="groups">
              @for (g of groups(); track g.group) {
                <div class="group">
                  <div class="group-header">
                    <button class="group-toggle" (click)="toggleCollapse(g.group)">
                      <span class="arrow" [class.expanded]="!isCollapsed(g.group)">&#9656;</span>
                      <span class="group-name">{{ g.group }}</span>
                      <span class="group-count">{{ g.kinds.length }}</span>
                    </button>
                    <input
                      type="checkbox"
                      class="group-all"
                      [checked]="groupState(g) === 'all'"
                      [indeterminate]="groupState(g) === 'some'"
                      (change)="toggleGroup(g)"
                      title="Select all in group"
                    />
                  </div>
                  @if (!isCollapsed(g.group)) {
                    @for (r of g.kinds; track r.id) {
                      <label class="kind-row" [class.off]="!vis.isVisible(r.id, 'tree')">
                        <input type="checkbox" [checked]="vis.isVisible(r.id, 'tree')" (change)="vis.toggle(r.id, 'tree')" />
                        <span class="kind-dot" [style.backgroundColor]="r.color"></span>
                        <span class="kind-label">{{ r.label }}</span>
                      </label>
                    }
                  }
                </div>
              }
            </div>

            <div class="panel-footer">
              <span class="footer-note">Tree only for now — graph column coming.</span>
              <button class="reset-btn" (click)="vis.reset()">Reset</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .vis-wrap { position: relative; }
    .vis-btn {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 6px;
      border: 1px solid var(--t-border); background: var(--t-bg-surface);
      color: var(--t-text-dim); cursor: pointer; transition: all 0.15s;
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
    }
    .overlay {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.82);
      display: flex; align-items: center; justify-content: center; z-index: 9000;
    }
    .panel {
      width: 340px; max-width: 92vw; max-height: 82vh; display: flex; flex-direction: column;
      background: var(--t-bg-surface); border: 1px solid var(--t-border);
      border-radius: 8px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      font-family: 'JetBrains Mono', 'Fira Code', monospace; color: var(--t-text);
    }
    .panel-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid var(--t-border);
    }
    .panel-title { font-size: 12px; font-weight: 700; color: var(--t-accent); letter-spacing: 0.04em; }
    .close-btn {
      width: 22px; height: 22px; border: none; background: transparent;
      color: var(--t-text-dim); cursor: pointer; font-size: 13px;
      &:hover { color: var(--t-accent); }
    }
    .panel-hint { padding: 8px 12px; font-size: 10px; color: var(--t-text-dim); line-height: 1.5; }
    .groups { overflow-y: auto; flex: 1; padding-bottom: 4px; }
    .group-header {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px; background: rgba(255, 255, 255, 0.03);
    }
    .group-toggle {
      flex: 1; display: flex; align-items: center; gap: 6px;
      border: none; background: transparent; color: var(--t-text-dim);
      cursor: pointer; font-family: inherit; font-size: 11px; text-align: left; padding: 0;
      &:hover { color: var(--t-accent); }
    }
    .arrow { display: inline-block; transition: transform 0.1s; font-size: 9px; }
    .arrow.expanded { transform: rotate(90deg); }
    .group-name { font-weight: 600; }
    .group-count { color: var(--t-text-dim); opacity: 0.6; }
    .kind-row {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 12px 4px 26px; cursor: pointer; font-size: 12px;
      &:hover { background: rgba(255, 255, 255, 0.04); }
    }
    .kind-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .kind-label { color: var(--t-text); }
    /* Unchecked kinds are dimmed so the active set stands out (still clickable). */
    .kind-row.off { opacity: 0.45; }
    .kind-row.off:hover { opacity: 0.7; }
    .panel-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 12px; border-top: 1px solid var(--t-border);
    }
    .footer-note { font-size: 9px; color: var(--t-text-dim); opacity: 0.7; }
    .reset-btn {
      font-size: 10px; padding: 3px 8px; border-radius: 4px;
      border: 1px solid var(--t-border); background: transparent;
      color: var(--t-text-dim); cursor: pointer; flex-shrink: 0;
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
    }
  `],
})
export class VisibilityPanelComponent {
  private config = inject(ConfigService);
  vis = inject(VisibilityService);
  open = signal(false);
  private userCollapsed = signal<Record<string, boolean>>({});

  // All kinds: config (nice label/colour) merged with discovered (by group/Kind).
  private allKinds = computed<KindRow[]>(() => {
    const byId = new Map<string, KindRow>();
    for (const r of this.config.resources()) {
      const id = kindId(r.group, r.kind);
      byId.set(id, { id, kind: r.kind, group: r.group, label: r.label, color: r.color });
    }
    for (const d of this.config.discovered()) {
      const id = kindId(d.group, d.kind);
      if (!byId.has(id)) byId.set(id, { id, kind: d.kind, group: d.group, label: d.kind, color: DISCOVERED_COLOR });
    }
    return [...byId.values()];
  });

  groups = computed(() => {
    const map = new Map<string, KindRow[]>();
    for (const r of this.allKinds()) {
      const g = r.group || 'core';
      (map.get(g) ?? map.set(g, []).get(g)!).push(r);
    }
    return [...map.entries()]
      .map(([group, kinds]) => ({ group, kinds: kinds.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => (a.group === 'core' ? -1 : b.group === 'core' ? 1 : a.group.localeCompare(b.group)));
  });

  onOpen(): void {
    this.config.ensureDiscovered();
    this.open.set(true);
  }

  // All groups expanded by default so the whole cluster is visible at a glance;
  // the user can still collapse a group manually.
  isCollapsed(group: string): boolean {
    return this.userCollapsed()[group] ?? false;
  }

  toggleCollapse(group: string): void {
    this.userCollapsed.update(c => ({ ...c, [group]: !this.isCollapsed(group) }));
  }

  groupState(g: { kinds: KindRow[] }): 'all' | 'some' | 'none' {
    const on = g.kinds.filter(r => this.vis.isVisible(r.id, 'tree')).length;
    return on === 0 ? 'none' : on === g.kinds.length ? 'all' : 'some';
  }

  toggleGroup(g: { kinds: KindRow[] }): void {
    const turnOn = this.groupState(g) !== 'all';
    for (const r of g.kinds) this.vis.set(r.id, 'tree', turnOn);
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('overlay')) this.open.set(false);
  }
}
