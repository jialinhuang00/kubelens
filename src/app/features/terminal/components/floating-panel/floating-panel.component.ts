import { Component, input, output, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragHandle, CdkDragEnd } from '@angular/cdk/drag-drop';
import { PanelState } from '../../models/panel.models';
import { PanelManagerService } from '../../services/panel-manager.service';
import { PanelExecutionService } from '../../services/panel-execution.service';
import { UiStateService } from '../../../dashboard/services/ui-state.service';
import { OutputDisplayComponent } from '../../../dashboard/components/output-display/output-display.component';
import { RolloutConsoleComponent } from '../../../dashboard/components/sidebar/rollout-console.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { DeploymentService } from '../../../k8s/services/deployment.service';
import { EcrService } from '../../../k8s/services/ecr.service';
import { RolloutStateService } from '../../../dashboard/services/rollout-state.service';
import { RolloutService } from '../../../dashboard/services/rollout.service';
import { TemplateService } from '../../../dashboard/services/template.service';

@Component({
  selector: 'app-floating-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDrag, CdkDragHandle, OutputDisplayComponent, RolloutConsoleComponent],
  providers: [UiStateService],
  templateUrl: './floating-panel.component.html',
  styleUrl: './floating-panel.component.scss',
})
export class FloatingPanelComponent {
  panel = input.required<PanelState>();
  closeRequest = output<string>();

  private panelManager = inject(PanelManagerService);
  private panelExecution = inject(PanelExecutionService);
  private deploymentService = inject(DeploymentService);
  private ecrService = inject(EcrService);
  private rolloutStateService = inject(RolloutStateService);
  private rolloutService = inject(RolloutService);
  private templateService = inject(TemplateService);

  editableCommand = signal('');

  // Rollout state
  rolloutExpanded = signal(false);
  rolloutTemplates = signal<CommandTemplate[]>([]);

  isDeployment = computed(() => this.panel().resourceKind === 'Deployment');
  deploymentStatus = this.deploymentService.deploymentStatus;
  rolloutHistory = this.deploymentService.rolloutHistory;
  buttonStates = computed(() => this.deploymentService.getButtonStates(this.deploymentStatus()));
  deploymentImage = computed(() => this.deploymentStatus()?.containerImage || '');

  // ECR state
  ecrTags = this.ecrService.tags;
  ecrIsLoading = this.ecrService.isLoading;
  ecrError = this.ecrService.error;

  private lastInitDeployment = '';

  // Set rollout templates once based on panel identity (not reactive to panel state changes)
  private rolloutInit = effect(() => {
    const p = this.panel();
    const key = `${p.resourceKind}:${p.resourceName}:${p.namespace}`;
    if (p.resourceKind === 'Deployment' && p.resourceName && key !== this.lastInitDeployment) {
      this.lastInitDeployment = key;
      this.rolloutTemplates.set(this.templateService.generateRolloutTemplates(p.resourceName));
      this.ecrService.clear();
    }
  });

  panelTitle = computed(() => {
    const p = this.panel();
    if (p.type === 'general') return 'Command Output';
    return `${p.resourceKind}: ${p.resourceName}`;
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

  onDragEnded(event: CdkDragEnd): void {
    const p = this.panel();
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

  onImageUpgrade(event: { deployment: string; image: string }): void {
    const p = this.panel();
    const command = this.rolloutService.generateSetImageCommand(event.deployment, p.namespace, event.image);
    this.panelExecution.execute(p.id, command);
    this.rolloutStateService.triggerRolloutAction('image-upgrade');
  }

  onLoadEcrTags(): void {
    const image = this.deploymentImage();
    if (image) {
      this.ecrService.fetchTags(image);
    }
  }

  onEcrTagSelect(tag: string): void {
    const p = this.panel();
    const image = this.deploymentImage();
    if (!image || !tag) return;
    // Replace the tag portion of the image URL
    const baseImage = image.replace(/:.*$/, '');
    const fullImage = `${baseImage}:${tag}`;
    const command = this.rolloutService.generateSetImageCommand(p.resourceName, p.namespace, fullImage);
    this.panelExecution.execute(p.id, command);
    this.rolloutStateService.triggerRolloutAction('ecr-tag-select');
  }

  onRefetchRolloutStatus(): void {
    const p = this.panel();
    this.deploymentService.fetchRolloutStatus(p.resourceName, p.namespace);
  }
}
