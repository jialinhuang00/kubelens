import { Component, computed, inject, signal } from '@angular/core';
import { ConfigService } from '../../../core/services/config.service';
import { VisibilityService } from '../../../core/services/visibility.service';

@Component({
  selector: 'app-visibility-panel',
  standalone: true,
  template: `
    <div class="vis-wrap">
      <button class="vis-btn" (click)="open.set(true)" title="Resource visibility">
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
            <div class="panel-hint">Hide kinds you don't want in the sidebar tree. Saved in your browser.</div>
            <div class="kind-list">
              @for (r of treeKinds(); track r.kind) {
                <label class="kind-row">
                  <input
                    type="checkbox"
                    [checked]="visibility.isVisible(r.kind, 'tree')"
                    (change)="visibility.toggle(r.kind, 'tree')"
                  />
                  <span class="kind-dot" [style.backgroundColor]="r.color"></span>
                  <span class="kind-label">{{ r.label }}</span>
                </label>
              }
            </div>
            <div class="panel-footer">
              <button class="reset-btn" (click)="visibility.reset()">Reset to defaults</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .vis-wrap { position: relative; }

    .vis-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--t-border);
      background: var(--t-bg-surface);
      color: var(--t-text-dim);
      cursor: pointer;
      transition: all 0.15s;
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9000;
    }

    .panel {
      width: 320px;
      max-width: 92vw;
      max-height: 80vh;
      overflow-y: auto;
      background: var(--t-bg-surface);
      border: 1px solid var(--t-border);
      border-radius: 8px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      color: var(--t-text);
    }

    .panel-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid var(--t-border);
    }

    .panel-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--t-accent);
      letter-spacing: 0.04em;
    }

    .close-btn {
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      color: var(--t-text-dim);
      cursor: pointer;
      font-size: 13px;
      &:hover { color: var(--t-accent); }
    }

    .panel-hint {
      padding: 8px 12px;
      font-size: 10px;
      color: var(--t-text-dim);
      line-height: 1.5;
    }

    .kind-list { padding: 4px 0 8px; }

    .kind-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      cursor: pointer;
      font-size: 12px;
      &:hover { background: rgba(255, 255, 255, 0.04); }
    }

    .kind-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .kind-label { color: var(--t-text); }

    .panel-footer {
      padding: 8px 12px;
      border-top: 1px solid var(--t-border);
    }

    .reset-btn {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--t-border);
      background: transparent;
      color: var(--t-text-dim);
      cursor: pointer;
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
    }
  `],
})
export class VisibilityPanelComponent {
  private config = inject(ConfigService);
  visibility = inject(VisibilityService);
  open = signal(false);

  // Kinds that can appear in the tree (config default). Toggling hides/shows them.
  treeKinds = computed(() => this.config.resources().filter(r => r.show?.includes('tree')));

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('overlay')) this.open.set(false);
  }
}
