import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ModeToggleComponent } from '../mode-toggle/mode-toggle.component';

/**
 * Persistent global navigation. Replaces the hub-and-spoke "back to home" model:
 * every view is reachable directly from here instead of bouncing through the landing page.
 */
@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, ModeToggleComponent],
  template: `
    <nav class="top-nav">
      <a class="brand" routerLink="/">◆ kubelens</a>
      <div class="links">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
        <a routerLink="/terminal" routerLinkActive="active">Terminal</a>
        <a routerLink="/universe" routerLinkActive="active">Universe</a>
        <a routerLink="/knowledge" routerLinkActive="active">Knowledge</a>
        <a routerLink="/benchmark" routerLinkActive="active">Benchmark</a>
      </div>
      <div class="right">
        <app-mode-toggle />
      </div>
    </nav>
  `,
  styles: [`
    .top-nav {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 44px;
      flex-shrink: 0;
      padding: 0 14px;
      background: var(--t-bg-panel);
      border-bottom: 1px solid var(--t-border);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    .brand {
      color: var(--t-accent);
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.03em;
      text-decoration: none;
      margin-right: 12px;
    }
    .links {
      display: flex;
      gap: 2px;
    }
    .links a {
      padding: 6px 12px;
      border-radius: var(--t-radius-sm);
      font-size: 13px;
      color: var(--t-text-dim);
      text-decoration: none;
      transition: color 0.15s, background 0.15s;
    }
    .links a:hover { color: var(--t-text-primary); }
    .links a.active {
      color: var(--t-text-primary);
      background: rgba(128, 128, 128, 0.1);
    }
    .right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
    }
  `],
})
export class TopNavComponent {}
