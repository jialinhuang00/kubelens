import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PanelManagerService } from '../../services/panel-manager.service';
import { FloatingPanelComponent } from '../floating-panel/floating-panel.component';

@Component({
  selector: 'app-panel-area',
  standalone: true,
  imports: [CommonModule, FloatingPanelComponent],
  templateUrl: './panel-area.component.html',
  styleUrl: './panel-area.component.scss',
})
export class PanelAreaComponent {
  protected panelManager = inject(PanelManagerService);

  onClosePanel(id: string): void {
    this.panelManager.closePanel(id);
  }

  onSwitchWorkspace(index: number): void {
    this.panelManager.switchWorkspace(index);
  }

  onAddWorkspace(): void {
    this.panelManager.addWorkspace();
  }

  onRemoveWorkspace(index: number, event: MouseEvent): void {
    event.stopPropagation();
    this.panelManager.removeWorkspace(index);
  }
}
