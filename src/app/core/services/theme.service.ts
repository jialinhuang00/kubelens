import { Injectable, signal, computed } from '@angular/core';

export type ThemeId = 'default' | 'lith-harbor' | 'ellinia' | 'perion';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  preview: string;
}

const VALID_THEMES = new Set<string>(['default', 'lith-harbor', 'ellinia', 'perion']);

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'kubecmds-theme';

  readonly themes: ThemeOption[] = [
    { id: 'default', label: 'Henesys', preview: '#d08840' },
    { id: 'lith-harbor', label: 'Lith Harbor', preview: '#3d8ec9' },
    { id: 'ellinia', label: 'Ellinia', preview: '#5aaa68' },
    { id: 'perion', label: 'Perion', preview: '#d4784a' },
  ];

  readonly activeTheme = signal<ThemeId>(this.loadTheme());

  readonly isDark = computed(() => {
    const t = this.activeTheme();
    return t === 'ellinia' || t === 'perion';
  });

  constructor() {
    this.applyTheme(this.activeTheme());
  }

  setTheme(id: ThemeId): void {
    this.activeTheme.set(id);
    this.applyTheme(id);
    localStorage.setItem(this.STORAGE_KEY, id);
  }

  private applyTheme(id: ThemeId): void {
    if (id === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', id);
    }
  }

  private loadTheme(): ThemeId {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return stored && VALID_THEMES.has(stored) ? (stored as ThemeId) : 'default';
  }
}
