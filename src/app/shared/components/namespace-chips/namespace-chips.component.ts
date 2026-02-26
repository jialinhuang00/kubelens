import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-namespace-chips',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="ns-section">
      <div class="section-label">Namespace</div>
      <input
        class="filter-input"
        type="text"
        placeholder="Filter namespaces..."
        [ngModel]="filter()"
        (ngModelChange)="filter.set($event)"
      />
      <div class="namespace-list">
        @for (ns of filtered(); track ns) {
          <button
            class="namespace-chip"
            [class.active]="selected() === ns"
            (click)="select.emit(ns)"
          >
            {{ ns }}
          </button>
        }
        @if (filtered().length === 0 && namespaces().length === 0) {
          <div class="empty-hint">Loading namespaces...</div>
        }
        @if (filtered().length === 0 && namespaces().length > 0) {
          <div class="empty-hint">No match</div>
        }
      </div>
    </div>
  `,
  styles: [`
    $accent: #e8b866;
    $bg: #0e0b08;
    $surface: #1c1610;
    $border: rgba(232, 184, 102, 0.12);
    $text: #e8dcc8;
    $text-dim: rgba(232, 220, 200, 0.5);
    $font: 'JetBrains Mono', 'Fira Code', monospace;

    .ns-section {
      padding: 10px 14px;
      border-bottom: 1px solid $border;
      font-family: $font;
    }

    .section-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: $text-dim;
      margin-bottom: 6px;
    }

    .filter-input {
      width: 100%;
      padding: 5px 8px;
      font-size: 11px;
      font-family: $font;
      background: $surface;
      border: 1px solid $border;
      border-radius: 4px;
      color: $text;
      outline: none;
      margin-bottom: 6px;
      box-sizing: border-box;

      &::placeholder {
        color: $text-dim;
      }

      &:focus {
        border-color: rgba(232, 184, 102, 0.3);
      }
    }

    .namespace-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 120px;
      overflow-y: auto;

      &::-webkit-scrollbar {
        width: 2px;
      }

      &::-webkit-scrollbar-thumb {
        background: rgba(232, 184, 102, 0.15);
      }
    }

    .namespace-chip {
      font-size: 10px;
      font-family: $font;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid $border;
      background: transparent;
      color: $text-dim;
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        border-color: rgba(232, 184, 102, 0.3);
        color: $text;
      }

      &.active {
        border-color: $accent;
        color: $accent;
        background: rgba(232, 184, 102, 0.08);
      }
    }

    .empty-hint {
      font-size: 10px;
      color: $text-dim;
      padding: 4px 0;
    }
  `],
})
export class NamespaceChipsComponent {
  readonly namespaces = input.required<string[]>();
  readonly selected = input<string | null>(null);
  readonly select = output<string>();

  readonly filter = signal('');

  readonly filtered = computed(() => {
    const f = this.filter().toLowerCase();
    const all = this.namespaces();
    return f ? all.filter(ns => ns.toLowerCase().includes(f)) : all;
  });
}
