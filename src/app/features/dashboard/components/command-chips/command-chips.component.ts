import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';

export interface ChipGroup {
  key: string;
  label: string;
  resourceName: string;  // selected resource name, empty if none
  color: string;         // CSS color for the group
  templates: CommandTemplate[];
}

@Component({
  selector: 'app-command-chips',
  imports: [CommonModule],
  templateUrl: './command-chips.component.html',
  styleUrl: './command-chips.component.scss'
})
export class CommandChipsComponent {
  @Input() groups: ChipGroup[] = [];
  @Input() disabled = false;

  @Output() templateExecute = new EventEmitter<CommandTemplate>();

  // Collapsible section state
  isCollapsed = signal(false);

  templateCount = computed(() => {
    return this.groups.reduce((sum, g) => sum + g.templates.length, 0);
  });

  toggleCollapse() {
    this.isCollapsed.update(v => !v);
  }

  onExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }
}
