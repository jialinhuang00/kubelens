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

  /** A tab lights up as a drop target while a panel from a *different* desktop is being dragged. */
  isDropTarget(index: number): boolean {
    const draggingId = this.panelManager.draggingPanelId();
    if (draggingId === null) return false;
    return this.panelManager.getPanelWorkspace(draggingId) !== index;
  }

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
