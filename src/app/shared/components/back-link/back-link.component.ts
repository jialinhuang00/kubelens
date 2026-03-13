import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-back-link',
  standalone: true,
  imports: [RouterLink],
  template: `
    <a class="back-link" [routerLink]="backPath">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      @if (label) {
        <span class="back-label">{{ label }}</span>
      }
    </a>
  `,
  styles: [`
    .back-link {
      color: var(--t-text-dim);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: color 0.15s;

      &:hover {
        color: var(--t-accent);
      }
    }

    .back-label {
      font-size: 15px;
      font-weight: 600;
      color: var(--t-accent);
    }
  `],
})
export class BackLinkComponent {
  @Input() label = '';
  @Input() backPath: string | string[] = '/';
}
