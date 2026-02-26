import { Component, signal } from '@angular/core';
import { TerminalSidebarComponent } from './terminal-sidebar/terminal-sidebar.component';
import { PanelAreaComponent } from './panel-area/panel-area.component';
import { ModeToggleComponent } from '../../../shared/components/mode-toggle/mode-toggle.component';

@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [TerminalSidebarComponent, PanelAreaComponent, ModeToggleComponent],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  readonly sidebarCollapsed = signal(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }
}
