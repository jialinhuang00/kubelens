import { Injectable, signal, computed } from '@angular/core';

export type ThemeId = 'default' | 'bondi-blue' | 'grape-soda' | 'xp-olive' | 'xp-silver';
export type ChromeStyle = 'cyberpunk' | 'mac' | 'xp';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  preview: string;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'kubecmds-theme';

  readonly themes: ThemeOption[] = [
    { id: 'default', label: 'Soft Gold', preview: '#e8b866' },
    { id: 'bondi-blue', label: 'Bondi Blue', preview: '#20a898' },
    { id: 'grape-soda', label: 'Grape Soda', preview: '#8050e0' },
    { id: 'xp-olive', label: 'XP Olive', preview: '#608820' },
    { id: 'xp-silver', label: 'XP Silver', preview: '#8890b0' },
  ];

  readonly activeTheme = signal<ThemeId>(this.loadTheme());

  readonly chromeStyle = computed<ChromeStyle>(() => {
    const t = this.activeTheme();
    if (t === 'bondi-blue' || t === 'grape-soda') return 'mac';
    if (t === 'xp-olive' || t === 'xp-silver') return 'xp';
    return 'cyberpunk';
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
    return (localStorage.getItem(this.STORAGE_KEY) as ThemeId) || 'default';
  }
}
