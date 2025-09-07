import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';

interface RolloutHistoryItem {
  revision: number;
  image: string;
  status: string;
  created: string;
}

@Component({
  selector: 'app-rollout-console',
  imports: [CommonModule, MatIconModule],
  templateUrl: './rollout-console.component.html',
  styleUrl: './rollout-console.component.scss'
})
export class RolloutConsoleComponent {
  @Input() deploymentName: string = '';
  @Input() isExpanded: boolean = false;
  @Input() rolloutTemplates: CommandTemplate[] = [];
  @Input() rolloutHistory: RolloutHistoryItem[] = [];
  @Input() currentStatus: string = '';
  
  @Output() toggleExpanded = new EventEmitter<void>();
  @Output() templateExecute = new EventEmitter<CommandTemplate>();
  @Output() imageUpgrade = new EventEmitter<{deployment: string, image: string}>();

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
    }
  }

  // Player controls
  onRollbackToPrevious() {
    const undoTemplate = this.rolloutTemplates.find(t => t.name === 'Undo Last');
    if (undoTemplate) {
      this.onTemplateExecute(undoTemplate);
    }
  }

  onPauseRollout() {
    const pauseTemplate = this.rolloutTemplates.find(t => t.name === 'Pause');
    if (pauseTemplate) {
      this.onTemplateExecute(pauseTemplate);
    }
  }

  onResumeRollout() {
    const resumeTemplate = this.rolloutTemplates.find(t => t.name === 'Resume');
    if (resumeTemplate) {
      this.onTemplateExecute(resumeTemplate);
    }
  }

  onRestartDeployment() {
    const restartTemplate = this.rolloutTemplates.find(t => t.name === 'Restart');
    if (restartTemplate) {
      this.onTemplateExecute(restartTemplate);
    }
  }
}