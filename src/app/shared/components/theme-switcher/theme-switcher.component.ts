import { Component, inject, signal, HostListener } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
  selector: 'app-theme-switcher',
  standalone: true,
  template: `
    <div class="theme-switcher">
      <button class="theme-btn" (click)="toggle()" [title]="'Theme: ' + themeService.activeTheme()">
        <span class="theme-dot" [style.background]="currentPreview()"></span>
      </button>
      @if (open()) {
        <div class="theme-dropdown">
          @for (t of themeService.themes; track t.id) {
            <button
              class="theme-option"
              [class.active]="themeService.activeTheme() === t.id"
              (click)="pick(t.id)">
              <span class="option-dot" [style.background]="t.preview"></span>
              <span class="option-label">{{ t.label }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .theme-switcher {
      position: relative;
    }

    .theme-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--t-border);
      background: var(--t-bg-surface);
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        border-color: var(--t-accent);
      }
    }

    .theme-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.3);
    }

    .theme-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 6px;
      background: var(--t-bg-surface);
      border: 1px solid var(--t-border);
      border-radius: 8px;
      padding: 4px;
      min-width: 150px;
      z-index: 100;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }

    .theme-option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--t-text-dim);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.12s;

      &:hover {
        background: rgba(128, 128, 128, 0.1);
        color: var(--t-text-primary);
      }

      &.active {
        color: var(--t-accent);
      }
    }

    .option-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
    }

    .option-label {
      flex: 1;
      text-align: left;
    }
  `],
})
export class ThemeSwitcherComponent {
  protected readonly themeService = inject(ThemeService);
  readonly open = signal(false);

  currentPreview() {
    const t = this.themeService.themes.find(t => t.id === this.themeService.activeTheme());
    return t?.preview ?? '#e8b866';
  }

  toggle() {
    this.open.update(v => !v);
  }

  pick(id: string) {
    this.themeService.setTheme(id as any);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent) {
    const el = event.target as HTMLElement;
    if (!el.closest('.theme-switcher')) {
      this.open.set(false);
    }
  }
}
