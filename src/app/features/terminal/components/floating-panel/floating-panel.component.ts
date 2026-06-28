import { Component, input, output, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragHandle, CdkDragEnd, CdkDragMove } from '@angular/cdk/drag-drop';
import { PanelState } from '../../models/panel.models';
import { PanelManagerService } from '../../services/panel-manager.service';
import { PanelExecutionService } from '../../services/panel-execution.service';
import { UiStateService } from '../../../dashboard/services/ui-state.service';
import { OutputDisplayComponent } from '../../../dashboard/components/output-display/output-display.component';
import { RolloutConsoleComponent } from '../../../dashboard/components/sidebar/rollout-console.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { DeploymentService } from '../../../k8s/services/deployment.service';
import { RegistryService } from '../../../k8s/services/registry.service';
import { RolloutStateService } from '../../../dashboard/services/rollout-state.service';
import { RolloutService } from '../../../dashboard/services/rollout.service';
import { TemplateService } from '../../../dashboard/services/template.service';

@Component({
  selector: 'app-floating-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDrag, CdkDragHandle, OutputDisplayComponent, RolloutConsoleComponent],
  providers: [UiStateService, RegistryService],
  templateUrl: './floating-panel.component.html',
  styleUrl: './floating-panel.component.scss',
})
export class FloatingPanelComponent {
  panel = input.required<PanelState>();
  closeRequest = output<string>();

  private panelManager = inject(PanelManagerService);
  private panelExecution = inject(PanelExecutionService);
  private deploymentService = inject(DeploymentService);
  private registryService = inject(RegistryService);
  private rolloutStateService = inject(RolloutStateService);
  private rolloutService = inject(RolloutService);
  private templateService = inject(TemplateService);

  editableCommand = signal('');

  // Rollout state
  rolloutExpanded = signal(false);
  rolloutTemplates = signal<CommandTemplate[]>([]);

  isDeployment = computed(() => this.panel().resourceKind === 'Deployment');
  deploymentStatus = computed(() =>
    this.deploymentService.getStatusForDeployment(this.panel().resourceName)
  );
  buttonStates = computed(() => this.deploymentService.getButtonStates(this.deploymentStatus()));
  deploymentImage = computed(() => this.deploymentStatus()?.containerImage || '');
  deploymentContainerName = computed(() => this.deploymentStatus()?.containerName || '');

  // Registry tag-picker state
  registryTags = this.registryService.tags;
  tagsLoading = this.registryService.isLoading;
  tagsError = this.registryService.error;

  private lastInitDeployment = '';

  // Set rollout templates once based on panel identity (not reactive to panel state changes)
  private rolloutInit = effect(() => {
    const p = this.panel();
    const key = `${p.resourceKind}:${p.resourceName}:${p.namespace}`;
    if (p.resourceKind === 'Deployment' && p.resourceName && key !== this.lastInitDeployment) {
      this.lastInitDeployment = key;
      this.rolloutTemplates.set(this.templateService.generateRolloutTemplates(p.resourceName));
      this.registryService.clear();
    }
  });

  panelTitle = computed(() => {
    const p = this.panel();
    if (p.type === 'general') return 'Command Output';
    return p.resourceName;
  });

  panelStyle = computed(() => {
    const p = this.panel();
    if (p.isMaximized) {
      return {
        position: 'absolute' as const,
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: p.zIndex,
      };
    }
    return {
      position: 'absolute' as const,
      left: `${p.position.x}px`,
      top: `${p.position.y}px`,
      width: `${p.size.width}px`,
      height: `${p.size.height}px`,
      zIndex: p.zIndex,
    };
  });

  onMouseDown(): void {
    this.panelManager.bringToFront(this.panel().id);
  }

  /**
   * Nearest workspace tab while the pointer is in (or just below) the workspace bar.
   * Picks by horizontal distance to each tab's center — "approaching desktop 3"
   * lights desktop 3 even if the pointer hasn't landed exactly on it. -1 = new desktop.
   */
  private nearestWorkspace(x: number, y: number): number | null {
    const bar = document.querySelector('.workspace-bar') as HTMLElement | null;
    if (!bar) return null;
    const barRect = bar.getBoundingClientRect();
    if (y > barRect.bottom + 24) return null; // not near the bar — this is a reposition

    let best: number | null = null;
    let bestDist = Infinity;
    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('[data-ws-index]'))) {
      const r = tab.getBoundingClientRect();
      const dist = Math.abs(x - (r.left + r.width / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = Number(tab.dataset['wsIndex']);
      }
    }
    return best;
  }

  onDragStarted(): void {
    this.panelManager.draggingPanelId.set(this.panel().id);
  }

  onDragMoved(event: CdkDragMove): void {
    const { x, y } = event.pointerPosition;
    const target = this.nearestWorkspace(x, y);
    this.panelManager.dragOverWorkspace.set(target);
    // Only show the proxy block once a desktop is actually targeted — not for the whole drag.
    this.panelManager.dragGhost.set(target !== null ? { x, y, label: this.panelTitle() } : null);
  }

  onDragEnded(event: CdkDragEnd): void {
    const p = this.panel();
    // Drop onto whatever tab is currently highlighted — keeps drop consistent with the hover.
    const target = this.panelManager.dragOverWorkspace();
    this.panelManager.draggingPanelId.set(null);
    this.panelManager.dragOverWorkspace.set(null);

    if (target !== null) {
      const isMove = target === -1 || target !== p.workspace;
      this.panelManager.dragGhost.set(null); // hover proxy is done; the panel itself does the throw
      event.source.reset();
      if (isMove) {
        // Panel collapses toward the cursor (which is on the chosen desktop); commit on landing.
        this.flingPanelInto(event.source.element.nativeElement, event.dropPoint, () => {
          if (target === -1) this.panelManager.movePanelToNewWorkspace(p.id);
          else this.panelManager.movePanelToWorkspace(p.id, target);
        });
      }
      return;
    }

    this.panelManager.dragGhost.set(null);
    const el = event.source.element.nativeElement;
    const transform = el.style.transform;

    const match = transform.match(/translate3d\((-?\d+)px,\s*(-?\d+)px/);
    if (match) {
      const dx = parseInt(match[1], 10);
      const dy = parseInt(match[2], 10);
      this.panelManager.updatePosition(p.id, {
        x: p.position.x + dx,
        y: p.position.y + dy,
      });
      event.source.reset();
    }
  }

  /** Collapse the panel toward `anchor` (viewport coords — the drop cursor), then run `done`. */
  private flingPanelInto(el: HTMLElement, anchor: { x: number; y: number }, done: () => void): void {
    const r = el.getBoundingClientRect();
    // transform-origin at the cursor (in the panel's local coords) so the panel shrinks INTO
    // that point — no center-collapse, no downward drift.
    const ox = anchor.x - r.left;
    const oy = anchor.y - r.top;
    el.style.transformOrigin = `${ox}px ${oy}px`;

    const anim = el.animate(
      [
        { transform: 'scale(1)', opacity: 1, offset: 0 },
        { transform: 'scale(0.06)', opacity: 0, offset: 1 },
      ],
      { duration: 300, easing: 'ease-in', fill: 'forwards' },
    );

    anim.onfinish = done;
    anim.oncancel = done;
  }

  onDoubleClickHeader(): void {
    this.panelManager.toggleMaximize(this.panel().id);
  }

  onClose(): void {
    const p = this.panel();
    if (p.streamStop) {
      p.streamStop();
    }
    this.closeRequest.emit(p.id);
  }

  onStop(): void {
    this.panelExecution.stopStream(this.panel().id);
  }

  onClearOutput(): void {
    this.panelManager.clearPanelOutput(this.panel().id);
  }

  onExecuteTemplate(template: CommandTemplate): void {
    const p = this.panel();
    const command = this.panelExecution.substituteCommand(
      template.command,
      p.namespace,
      p.resourceName,
    );
    if (template.requiresInput) {
      this.editableCommand.set(command);
    } else {
      this.panelExecution.execute(p.id, command);
    }
  }

  onRunEditableCommand(): void {
    const cmd = this.editableCommand().trim();
    if (!cmd) return;
    this.panelExecution.execute(this.panel().id, cmd);
    this.editableCommand.set('');
  }

  onEditableKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onRunEditableCommand();
    } else if (event.key === 'Escape') {
      this.editableCommand.set('');
    }
  }

  onDismissEditable(): void {
    this.editableCommand.set('');
  }

  onResizeStart(event: MouseEvent, direction: 'e' | 's' | 'se'): void {
    event.preventDefault();
    event.stopPropagation();

    const p = this.panel();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = p.size.width;
    const startH = p.size.height;
    const MIN_W = 280;
    const MIN_H = 180;

    const container = (event.target as HTMLElement).closest('.panel-area') as HTMLElement | null;
    const maxW = container ? container.clientWidth  - p.position.x : Infinity;
    const maxH = container ? container.clientHeight - p.position.y : Infinity;

    const onMove = (e: MouseEvent) => {
      const newSize = { width: startW, height: startH };
      if (direction === 'e' || direction === 'se') newSize.width  = Math.min(maxW, Math.max(MIN_W, startW + e.clientX - startX));
      if (direction === 's' || direction === 'se') newSize.height = Math.min(maxH, Math.max(MIN_H, startH + e.clientY - startY));
      this.panelManager.updateSize(this.panel().id, newSize);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  private hasFetchedStatus = false;

  // Rollout handlers
  onToggleRollout(): void {
    this.rolloutExpanded.update(v => !v);
    if (this.rolloutExpanded() && !this.hasFetchedStatus) {
      this.hasFetchedStatus = true;
      const p = this.panel();
      this.deploymentService.fetchRolloutStatus(p.resourceName, p.namespace);
    }
  }

  onRolloutTemplateExecute(template: CommandTemplate): void {
    const p = this.panel();
    const command = this.panelExecution.substituteCommand(template.command, p.namespace, p.resourceName);
    this.panelExecution.execute(p.id, command);
  }

  onLoadTags(): void {
    const image = this.deploymentImage();
    if (image) {
      this.registryService.fetchTags(image);
    }
  }

  onTagSelect(tag: string): void {
    const p = this.panel();
    const image = this.deploymentImage();
    const container = this.deploymentContainerName();
    if (!image || !tag || !container) return;
    const baseImage = image.replace(/:.*$/, '');
    const fullImage = `${baseImage}:${tag}`;
    const command = this.rolloutService.generateSetImageCommand(p.resourceName, container, p.namespace, fullImage);
    this.panelExecution.execute(p.id, command);
    this.rolloutStateService.triggerRolloutAction('tag-select');
  }

  onRefetchRolloutStatus(): void {
    const p = this.panel();
    this.deploymentService.fetchRolloutStatus(p.resourceName, p.namespace);
  }
}
