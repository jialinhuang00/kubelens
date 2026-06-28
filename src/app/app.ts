import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataModeService } from './core/services/data-mode.service';
import { ThemeService } from './core/services/theme.service';
import { TopNavComponent } from './shared/components/top-nav/top-nav.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopNavComponent],
  template: `
    <div class="app-shell">
      <app-top-nav />
      <main class="app-outlet"><router-outlet></router-outlet></main>
    </div>
  `,
  styles: [`
    .app-shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    .app-outlet { flex: 1; min-height: 0; overflow: auto; }
  `],
})
export class App implements OnInit {
  private readonly dataModeService = inject(DataModeService);
  // Instantiate ThemeService at the root so it applies the theme on load (nothing
  // else injects it now that the theme-switcher is gone).
  private readonly themeService = inject(ThemeService);

  ngOnInit(): void {
    this.dataModeService.checkAvailability();
  }
}
