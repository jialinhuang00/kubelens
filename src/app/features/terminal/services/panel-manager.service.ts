import { Injectable, signal, computed } from '@angular/core';
import {
  PanelState,
  PanelPosition,
  PanelSize,
  DEFAULT_RESOURCE_SIZE,
  DEFAULT_GENERAL_SIZE,
  CASCADE_OFFSET,
  EMPTY_OUTPUT_DATA,
} from '../models/panel.models';
import { OutputData } from '../../../shared/interfaces/output-data.interface';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

@Injectable({ providedIn: 'root' })
export class PanelManagerService {
  private panels = signal<Map<string, PanelState>>(new Map());
  private nextZIndex = 1;

  // Workspace state
  activeWorkspace = signal(0);
  workspaceCount = signal(1);

  // Only panels in the active workspace
  panelList = computed(() =>
    [...this.panels().values()].filter(p => p.workspace === this.activeWorkspace())
  );
  panelCount = computed(() => this.panelList().length);

  // All panels (for sidebar checkbox state)
  allPanels = computed(() => this.panels());

  workspaces = computed(() => {
    const count = this.workspaceCount();
    const all = this.panels();
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      panelCount: [...all.values()].filter(p => p.workspace === i).length,
    }));
  });

  hasPanel(id: string): boolean {
    return this.panels().has(id);
  }

  /** Returns the workspace index if panel exists, or -1 */
  getPanelWorkspace(id: string): number {
    const panel = this.panels().get(id);
    return panel ? panel.workspace : -1;
  }

  /** True if panel exists in a workspace OTHER than the active one */
  isInOtherWorkspace(id: string): boolean {
    const panel = this.panels().get(id);
    return !!panel && panel.workspace !== this.activeWorkspace();
  }

  getPanel(id: string): PanelState | undefined {
    return this.panels().get(id);
  }

  openResourcePanel(kind: string, name: string, namespace: string, templates: CommandTemplate[]): string {
    const id = `${kind}:${name}`;

    if (this.panels().has(id)) {
      // Switch to its workspace and bring to front
      const existing = this.panels().get(id)!;
      this.activeWorkspace.set(existing.workspace);
      this.bringToFront(id);
      return id;
    }

    const ws = this.activeWorkspace();
    const wsCount = this.panelList().length;
    const panel: PanelState = {
      id,
      type: 'resource',
      resourceKind: kind,
      resourceName: name,
      namespace,
      workspace: ws,
      position: { x: 20 + CASCADE_OFFSET * wsCount, y: 20 + CASCADE_OFFSET * wsCount },
      size: { ...DEFAULT_RESOURCE_SIZE },
      zIndex: this.nextZIndex++,
      isMaximized: false,
      isLoading: false,
      isStreaming: false,
      outputData: { ...EMPTY_OUTPUT_DATA },
      activeCommand: '',
      streamStop: null,
      templates,
    };

    const next = new Map(this.panels());
    next.set(id, panel);
    this.panels.set(next);
    return id;
  }

  openGeneralPanel(): string {
    const id = `general:${Date.now()}`;
    const ws = this.activeWorkspace();
    const wsCount = this.panelList().length;

    const panel: PanelState = {
      id,
      type: 'general',
      resourceKind: '',
      resourceName: '',
      namespace: '',
      workspace: ws,
      position: { x: 40 + CASCADE_OFFSET * wsCount, y: 40 + CASCADE_OFFSET * wsCount },
      size: { ...DEFAULT_GENERAL_SIZE },
      zIndex: this.nextZIndex++,
      isMaximized: false,
      isLoading: false,
      isStreaming: false,
      outputData: { ...EMPTY_OUTPUT_DATA },
      activeCommand: '',
      streamStop: null,
      templates: [],
    };

    const next = new Map(this.panels());
    next.set(id, panel);
    this.panels.set(next);
    return id;
  }

  closePanel(id: string): void {
    const next = new Map(this.panels());
    next.delete(id);
    this.panels.set(next);
  }

  bringToFront(id: string): void {
    const panel = this.panels().get(id);
    if (!panel) return;
    const next = new Map(this.panels());
    next.set(id, { ...panel, zIndex: this.nextZIndex++ });
    this.panels.set(next);
  }

  updatePosition(id: string, position: PanelPosition): void {
    this.updatePanel(id, { position });
  }

  updateSize(id: string, size: PanelSize): void {
    this.updatePanel(id, { size });
  }

  toggleMaximize(id: string): void {
    const panel = this.panels().get(id);
    if (!panel) return;
    this.updatePanel(id, { isMaximized: !panel.isMaximized });
  }

  updatePanelOutput(id: string, partial: Partial<PanelState>): void {
    this.updatePanel(id, partial);
  }

  // Workspace operations
  switchWorkspace(index: number): void {
    if (index >= 0 && index < this.workspaceCount()) {
      this.activeWorkspace.set(index);
    }
  }

  addWorkspace(): void {
    const newIndex = this.workspaceCount();
    this.workspaceCount.update(c => c + 1);
    this.activeWorkspace.set(newIndex);
  }

  removeWorkspace(index: number): void {
    if (this.workspaceCount() <= 1) return;

    // Close all panels in this workspace
    const next = new Map(this.panels());
    for (const [id, panel] of next) {
      if (panel.workspace === index) {
        if (panel.streamStop) panel.streamStop();
        next.delete(id);
      } else if (panel.workspace > index) {
        // Shift down
        next.set(id, { ...panel, workspace: panel.workspace - 1 });
      }
    }
    this.panels.set(next);
    this.workspaceCount.update(c => c - 1);

    // Adjust active workspace
    if (this.activeWorkspace() >= this.workspaceCount()) {
      this.activeWorkspace.set(this.workspaceCount() - 1);
    } else if (this.activeWorkspace() > index) {
      this.activeWorkspace.update(w => w - 1);
    }
  }

  movePanelToWorkspace(id: string, workspace: number): void {
    this.updatePanel(id, { workspace });
  }

  private updatePanel(id: string, partial: Partial<PanelState>): void {
    const panel = this.panels().get(id);
    if (!panel) return;
    const next = new Map(this.panels());
    next.set(id, { ...panel, ...partial });
    this.panels.set(next);
  }

  closeAll(): void {
    this.panels.set(new Map());
    this.nextZIndex = 1;
    this.activeWorkspace.set(0);
    this.workspaceCount.set(1);
  }
}
