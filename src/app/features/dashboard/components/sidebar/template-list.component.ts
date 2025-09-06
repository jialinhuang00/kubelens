import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { CommandDisplayDirective } from '../../../../shared/directives/command-display.directive';

@Component({
  selector: 'app-template-list',
  imports: [CommonModule, CommandDisplayDirective],
  templateUrl: './template-list.component.html',
  styleUrl: './template-list.component.scss'
})
export class TemplateListComponent {
  @Input() templates: CommandTemplate[] = [];
  @Input() accentColor: 'cyan' | 'purple' | 'orange' | 'green' = 'green';
  @Input() selectedResource: string = '';
  @Input() resourceType: 'deployment' | 'pod' | 'service' | 'general' = 'general';

  @Output() templateExecute = new EventEmitter<CommandTemplate>();

  get accentColorClass(): string {
    const colorMap = {
      'cyan': 'var(--accent-cyan)',
      'purple': 'var(--accent-purple)',
      'orange': 'var(--accent-orange, #ff9500)',
      'green': 'var(--accent-green)'
    };
    return colorMap[this.accentColor];
  }

  get templateBackgroundColor(): string {
    const colorMap = {
      'cyan': 'rgba(0, 212, 255, 0.08)',
      'purple': 'rgba(157, 78, 221, 0.08)',
      'orange': 'rgba(255, 149, 0, 0.08)',
      'green': 'rgba(255, 255, 255, 0.03)'
    };
    return colorMap[this.accentColor];
  }

  get templateBorderColor(): string {
    const colorMap = {
      'cyan': 'rgba(0, 212, 255, 0.2)',
      'purple': 'rgba(157, 78, 221, 0.2)',
      'orange': 'rgba(255, 149, 0, 0.2)',
      'green': 'rgba(255, 255, 255, 0.08)'
    };
    return colorMap[this.accentColor];
  }

  get templateBoxShadow(): string {
    const colorMap = {
      'cyan': '0 1px 3px rgba(0, 212, 255, 0.1)',
      'purple': '0 1px 3px rgba(157, 78, 221, 0.1)',
      'orange': '0 1px 3px rgba(255, 149, 0, 0.1)',
      'green': 'none'
    };
    return colorMap[this.accentColor];
  }

  onTemplateExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }

  get isGeneralTemplate(): boolean {
    return this.resourceType === 'general';
  }
}