import { Component, inject, signal } from '@angular/core';
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

  /** The desktop the dragged panel already lives on — dropping there is a no-op, so show it disabled. */
  isDropDisabled(index: number): boolean {
    const draggingId = this.panelManager.draggingPanelId();
    if (draggingId === null) return false;
    return this.panelManager.getPanelWorkspace(draggingId) === index;
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

  /** Which desktop tab is currently being renamed (null = none). */
  editingWorkspace = signal<number | null>(null);

  startRename(index: number): void {
    this.editingWorkspace.set(index);
    // The input mounts on the next render; focus + select it once it's in the DOM.
    setTimeout(() => {
      const el = document.querySelector('.workspace-rename') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  commitRename(index: number, event: Event): void {
    if (this.editingWorkspace() !== index) return; // Enter already committed; ignore the trailing blur.
    this.panelManager.renameWorkspace(index, (event.target as HTMLInputElement).value);
    this.editingWorkspace.set(null);
  }

  cancelRename(): void {
    this.editingWorkspace.set(null);
  }
}
