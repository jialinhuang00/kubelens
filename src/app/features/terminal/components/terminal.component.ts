import { Component } from '@angular/core';
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
export class TerminalComponent {}
