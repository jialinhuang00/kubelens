import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { RolloutConsoleComponent } from '../sidebar/rollout-console.component';
import { DeploymentStatus, RolloutButtonStates, RolloutHistoryItem } from '../../../k8s/services/deployment.service';

export interface ChipGroup {
  key: string;
  label: string;
  resourceName: string;  // selected resource name, empty if none
  color: string;         // CSS color for the group
  templates: CommandTemplate[];
}

@Component({
  selector: 'app-command-chips',
  imports: [CommonModule, RolloutConsoleComponent],
  templateUrl: './command-chips.component.html',
  styleUrl: './command-chips.component.scss'
})
export class CommandChipsComponent {
  @Input() groups: ChipGroup[] = [];
  @Input() disabled = false;

  // ECR tag picker inputs
  @Input() ecrTags: string[] = [];
  @Input() ecrIsLoading = false;
  @Input() ecrError = '';
  @Input() deploymentImage = '';  // non-empty when deployment has an ECR image

  // Rollout console inputs
  @Input() deploymentName = '';
  @Input() isRolloutExpanded = false;
  @Input() rolloutTemplates: CommandTemplate[] = [];
  @Input() deploymentStatus: DeploymentStatus | null = null;
  @Input() buttonStates: RolloutButtonStates | null = null;
  @Input() rolloutHistory: RolloutHistoryItem[] = [];

  @Output() templateExecute = new EventEmitter<CommandTemplate>();
  @Output() loadEcrTags = new EventEmitter<void>();
  @Output() ecrTagSelect = new EventEmitter<string>();
  @Output() toggleRolloutExpanded = new EventEmitter<void>();
  @Output() imageUpgrade = new EventEmitter<{ deployment: string, image: string }>();
  @Output() refetchStatus = new EventEmitter<void>();

  // Collapsible section state
  isCollapsed = signal(false);

  // Groups that have been expanded via "show more"
  expandedGroups = signal<Set<string>>(new Set());

  // Max chips visible before "show more"
  readonly maxVisible = 6;

  templateCount = computed(() => {
    return this.groups.reduce((sum, g) => sum + g.templates.length, 0);
  });

  toggleCollapse() {
    this.isCollapsed.update(v => !v);
  }

  toggleGroupExpand(key: string) {
    this.expandedGroups.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  isGroupExpanded(key: string): boolean {
    return this.expandedGroups().has(key);
  }

  visibleTemplates(group: ChipGroup): CommandTemplate[] {
    if (group.templates.length <= this.maxVisible || this.isGroupExpanded(group.key)) {
      return group.templates;
    }
    return group.templates.slice(0, this.maxVisible);
  }

  hiddenCount(group: ChipGroup): number {
    if (group.templates.length <= this.maxVisible || this.isGroupExpanded(group.key)) return 0;
    return group.templates.length - this.maxVisible;
  }

  onExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }
}
