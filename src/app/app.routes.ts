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
    path: 'universe',
    loadComponent: () =>
      import('./features/universe/components/universe.component').then(
        (m) => m.UniverseComponent
      ),
  },
  {
    path: 'benchmark',
    loadComponent: () =>
      import('./features/benchmark/benchmark.component').then(
        (m) => m.BenchmarkComponent
      ),
  },
  {
    path: 'knowledge',
    loadComponent: () =>
      import('./features/knowledge/knowledge.component').then(
        (m) => m.KnowledgeComponent
      ),
  },
  {
    path: 'snapshot',
    loadComponent: () =>
      import('./features/snapshot/snapshot.component').then(
        (m) => m.SnapshotComponent
      ),
  },
];
