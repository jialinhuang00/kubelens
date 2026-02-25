import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then(
        (m) => m.HomeComponent
      ),
  },
  {
    path: 'terminal',
    loadComponent: () =>
      import('./features/terminal/components/terminal.component').then(
        (m) => m.TerminalComponent
      ),
  },
  {
    path: 'terminal-legacy',
    loadComponent: () =>
      import('./features/dashboard/components/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'universe',
    loadComponent: () =>
      import('./features/universe/components/universe.component').then(
        (m) => m.UniverseComponent
      ),
  },
];
