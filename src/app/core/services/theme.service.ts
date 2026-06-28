import { Injectable, signal, computed } from '@angular/core';

export type ThemeId = 'default' | 'lith-harbor' | 'ellinia' | 'perion' | 'ossyria' | 'el-nath';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  preview: string;
}

const VALID_THEMES = new Set<string>(['default', 'lith-harbor', 'ellinia', 'perion', 'ossyria', 'el-nath']);

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'kubecmds-theme';

  readonly themes: ThemeOption[] = [
    { id: 'default', label: 'Henesys', preview: '#d08840' },
    { id: 'lith-harbor', label: 'Lith Harbor', preview: '#3d8ec9' },
    { id: 'ellinia', label: 'Ellinia', preview: '#5aaa68' },
    { id: 'perion', label: 'Perion', preview: '#d4784a' },
    { id: 'ossyria', label: 'Ossyria', preview: '#222222' },
    { id: 'el-nath', label: 'El Nath', preview: '#88c0d0' },
  ];

  readonly activeTheme = signal<ThemeId>(this.loadTheme());

  readonly isDark = computed(() => {
    const t = this.activeTheme();
    return t === 'ellinia' || t === 'perion' || t === 'el-nath';
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
    // Single theme now (Nord / El Nath). Kept as a service so views can stay theme-token driven.
    return 'el-nath';
  }
}
