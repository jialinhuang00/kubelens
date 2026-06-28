import { Component, signal, HostListener } from '@angular/core';
import { TerminalSidebarComponent } from './terminal-sidebar/terminal-sidebar.component';
import { PanelAreaComponent } from './panel-area/panel-area.component';
import { CommandBarComponent } from './command-bar/command-bar.component';
import { HandbookComponent } from '../../../shared/components/handbook/handbook.component';
import { MemMonitorComponent } from '../../../shared/components/mem-monitor/mem-monitor.component';
import { VisibilityPanelComponent } from '../../../shared/components/visibility-panel/visibility-panel.component';

@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [TerminalSidebarComponent, PanelAreaComponent, CommandBarComponent, HandbookComponent, MemMonitorComponent, VisibilityPanelComponent],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  readonly sidebarCollapsed = signal(false);

  @HostListener('window:keydown.s', ['$event'])
  onSKey(event: Event): void {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    event.preventDefault();
    this.toggleSidebar();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }
}
