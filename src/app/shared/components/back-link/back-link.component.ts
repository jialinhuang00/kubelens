import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-back-link',
  standalone: true,
  imports: [RouterLink],
  template: `
    <a class="back-link" routerLink="/">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </a>
  `,
  styles: [`
    .back-link {
      color: rgba(232, 220, 200, 0.5);
      text-decoration: none;
      display: flex;
      cursor: pointer;
      transition: color 0.15s;

      &:hover {
        color: #e8b866;
      }
    }
  `],
})
export class BackLinkComponent {}
