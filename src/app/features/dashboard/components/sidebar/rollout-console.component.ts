import { Component, Input, Output, EventEmitter, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { DeploymentStatus, RolloutButtonStates, RolloutHistoryItem } from '../../../k8s/services/deployment.service';
import { ClipboardService } from '../../../../shared/services/clipboard.service';
import { RolloutStateService } from '../../services/rollout-state.service';

@Component({
  selector: 'app-rollout-console',
  imports: [CommonModule, MatIconModule],
  templateUrl: './rollout-console.component.html',
  styleUrl: './rollout-console.component.scss'
})
export class RolloutConsoleComponent {
  private clipboardService = inject(ClipboardService);
  private rolloutStateService = inject(RolloutStateService);

  @Input() deploymentName: string = '';
  @Input() isExpanded: boolean = false;
  @Input() rolloutTemplates: CommandTemplate[] = [];
  @Input() rolloutHistory: RolloutHistoryItem[] = [];
  @Input() currentStatus: string = '';
  @Input() deploymentStatus: DeploymentStatus | null = null;
  @Input() buttonStates: RolloutButtonStates | null = null;

  @Output() toggleExpanded = new EventEmitter<void>();
  @Output() templateExecute = new EventEmitter<CommandTemplate>();
  @Output() imageUpgrade = new EventEmitter<{ deployment: string, image: string }>();

  // UI State
  showHistoryTable = signal<boolean>(false);
  selectedVersion = signal<string>('');

  onToggleExpanded() {
    this.toggleExpanded.emit();
  }

  onTemplateExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }

  onToggleHistory() {
    this.showHistoryTable.update(show => !show);
  }

  onUpgradeToVersion(version: string) {
    if (this.deploymentName && version) {
      this.imageUpgrade.emit({
        deployment: this.deploymentName,
        image: `jia0/${this.deploymentName}:${version}`
      });
      this.rolloutStateService.triggerRolloutAction(`upgrade-${version}`);
    }
  }

  // Player controls
  onRollbackToPrevious() {
    const undoTemplate = this.rolloutTemplates.find(t => t.name === 'Undo Last');
    if (undoTemplate) {
      this.onTemplateExecute(undoTemplate);
      this.rolloutStateService.triggerRolloutAction('rollback');
    }
  }

  onPauseRollout() {
    const pauseTemplate = this.rolloutTemplates.find(t => t.name === 'Pause');
    if (pauseTemplate) {
      this.onTemplateExecute(pauseTemplate);
      this.rolloutStateService.triggerRolloutAction('pause');
    }
  }

  onResumeRollout() {
    const resumeTemplate = this.rolloutTemplates.find(t => t.name === 'Resume');
    if (resumeTemplate) {
      this.onTemplateExecute(resumeTemplate);
      this.rolloutStateService.triggerRolloutAction('resume');
    }
  }

  onRestartDeployment() {
    const restartTemplate = this.rolloutTemplates.find(t => t.name === 'Restart');
    if (restartTemplate) {
      this.onTemplateExecute(restartTemplate);
      this.rolloutStateService.triggerRolloutAction('restart');
    }
  }

  getStatusColor(lightType: 'red' | 'yellow' | 'green'): string {
    if (!this.deploymentStatus || !this.buttonStates) return '#4a4a4a';

    const { isPaused, progressingReason, status, replicas } = this.deploymentStatus;

    let activeLight: 'red' | 'yellow' | 'green' | 'multiple' = 'green';

    // 1. check erro?
    if (status === 'Failed' ||
      progressingReason === 'ProgressDeadlineExceeded' ||
      progressingReason === 'ReplicaSetCreateError' ||
      replicas.ready === 0 && replicas.desired > 0) {
      activeLight = 'red';
    }
    // 2. is paused then yellow
    else if (isPaused) {
      activeLight = 'yellow';
    }
    // 3. is rolling out, then green and yellow
    else if (progressingReason === 'ReplicaSetUpdated' ||
      progressingReason === 'FoundNewReplicaSet' ||
      (replicas.ready < replicas.desired && replicas.desired > 0)) {
      activeLight = 'multiple';
    }
    // 4. stable then green
    else if (progressingReason === 'NewReplicaSetAvailable' &&
      replicas.ready === replicas.desired) {
      activeLight = 'green';
    }
    // 5. fallback
    else {
      activeLight = 'yellow';
    }

    if (activeLight === 'multiple') {
      // Rolling out
      if (lightType === 'yellow' || lightType === 'green') {
        switch (lightType) {
          case 'yellow': return '#ffbd2e';
          case 'green': return '#28ca42';
        }
      } else {
        return '#4a4a4a';
      }
    } else if (lightType === activeLight) {
      switch (lightType) {
        case 'red': return '#ff5f57';
        case 'yellow': return '#ffbd2e';
        case 'green': return '#28ca42';
      }
    }

    return '#4a4a4a';
  }

  // get status text
  getStatusText(): string {
    if (!this.deploymentStatus) return '';

    const { isPaused, progressingReason, replicas } = this.deploymentStatus;

    if (isPaused) {
      return '(paused)';
    } else if (progressingReason === 'ReplicaSetUpdated' ||
      progressingReason === 'FoundNewReplicaSet' ||
      (replicas.ready < replicas.desired && replicas.desired > 0)) {
      return '(rolling out)';
    } else if (progressingReason === 'NewReplicaSetAvailable' &&
      replicas.ready === replicas.desired) {
      return '(stable)';
    } else if (replicas.ready === 0 && replicas.desired > 0) {
      return '(failed)';
    }

    return '(unknown)';
  }

  // tooltip content
  getPauseTooltip(): string {
    if (!this.deploymentStatus) return 'Pause Rollout';

    const { isPaused, progressingReason } = this.deploymentStatus;

    if (isPaused) {
      return 'Deployment is already paused';
    } else if (progressingReason === 'ReplicaSetUpdated' || progressingReason === 'FoundNewReplicaSet') {
      return 'Pause current rollout - stops the deployment update process';
    } else if (progressingReason === 'NewReplicaSetAvailable') {
      return 'Pause deployment - prepares for next update by marking as paused';
    }

    return 'Pause deployment rollout';
  }

  getResumeTooltip(): string {
    if (!this.deploymentStatus) return 'Resume Rollout';

    const { isPaused } = this.deploymentStatus;

    if (isPaused) {
      return 'Resume paused rollout - continues the deployment update process';
    } else {
      return 'No paused rollout to resume';
    }
  }

  getRestartTooltip(): string {
    if (!this.deploymentStatus) return 'Restart Deployment';

    const { isPaused, progressingReason } = this.deploymentStatus;

    if (isPaused) {
      return 'Cannot restart while paused - resume deployment first';
    } else if (progressingReason === 'ReplicaSetUpdated' || progressingReason === 'FoundNewReplicaSet') {
      return 'Restart deployment - cancels current rollout and starts fresh';
    } else {
      return 'Restart deployment - triggers rolling restart of all pods';
    }
  }

  getRollbackTooltip(): string {
    if (!this.deploymentStatus) return 'Rollback to Previous Version';

    const { isPaused, progressingReason } = this.deploymentStatus;

    if (isPaused) {
      return 'Cannot rollback while paused - resume deployment first';
    } else if (progressingReason === 'ReplicaSetUpdated' || progressingReason === 'FoundNewReplicaSet') {
      return 'Rollback to previous version - will cancel current rollout and start rollback';
    } else {
      return 'Rollback to previous deployment version';
    }
  }

  async onCopyToClipboard(text: string, event?: Event): Promise<void> {
    await this.clipboardService.copyToClipboard(text, event);
  }
}