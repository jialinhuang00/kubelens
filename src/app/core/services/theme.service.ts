import { Injectable, signal } from '@angular/core';

/**
 * One theme (Nord), folded into `:root` in styles.scss. What used to be a picker
 * is down to a single signal, and the signal is the point: universe.component and
 * knowledge.component read it inside an effect so their WebGL palettes re-read the
 * CSS variables whenever it changes. The canvas has no CSS of its own — colours
 * are copied out of the variables in TypeScript — so without that trigger a theme
 * change would repaint the page and leave the graph on the old colours.
 *
 * Give the app themes again and those two views follow with no further work.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly activeTheme = signal('nord');
}
