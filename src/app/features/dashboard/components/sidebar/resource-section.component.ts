import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TemplateListComponent } from './template-list.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { CommandDisplayDirective } from '../../../../shared/directives/command-display.directive';

@Component({
  selector: 'app-resource-section',
  imports: [CommonModule, TemplateListComponent, CommandDisplayDirective],
  templateUrl: './resource-section.component.html',
  styleUrl: './resource-section.component.scss'
})
export class ResourceSectionComponent {
  @Input() title: string = '';
  @Input() resources: string[] = [];
  @Input() selectedResource: string = '';
  @Input() templates: CommandTemplate[] = [];
  @Input() isExpanded: boolean = false;
  @Input() isInitializing: boolean = false;
  @Input() resourceType: 'deployment' | 'pod' | 'service' | 'general' = 'general';
  @Input() accentColor: 'cyan' | 'purple' | 'orange' | 'green' = 'green';

  @Output() resourceChange = new EventEmitter<string>();
  @Output() templateExecute = new EventEmitter<CommandTemplate>();
  @Output() toggleExpanded = new EventEmitter<void>();

  get accentColorClass(): string {
    const colorMap = {
      'cyan': 'var(--accent-cyan)',
      'purple': 'var(--accent-purple)', 
      'orange': 'var(--accent-orange, #ff9500)',
      'green': 'var(--accent-green)'
    };
    return colorMap[this.accentColor];
  }

  get backgroundColorClass(): string {
    const colorMap = {
      'cyan': 'rgba(0, 212, 255, 0.05)',
      'purple': 'rgba(157, 78, 221, 0.05)',
      'orange': 'rgba(255, 149, 0, 0.05)',
      'green': 'rgba(57, 255, 20, 0.05)'
    };
    return colorMap[this.accentColor];
  }

  get borderColorClass(): string {
    const colorMap = {
      'cyan': 'rgba(0, 212, 255, 0.15)',
      'purple': 'rgba(157, 78, 221, 0.15)',
      'orange': 'rgba(255, 149, 0, 0.15)',
      'green': 'rgba(57, 255, 20, 0.15)'
    };
    return colorMap[this.accentColor];
  }

  get sectionBorderColor(): string {
    const colorMap = {
      'cyan': 'rgba(0, 212, 255, 0.3)',
      'purple': 'rgba(157, 78, 221, 0.3)',
      'orange': 'rgba(255, 149, 0, 0.3)',
      'green': 'rgba(57, 255, 20, 0.3)'
    };
    return colorMap[this.accentColor];
  }

  onResourceChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.resourceChange.emit(target.value);
  }

  onTemplateExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }

  onToggleExpanded() {
    this.toggleExpanded.emit();
  }

  get hasResourceSelector(): boolean {
    return this.resourceType !== 'general' && this.resources.length > 0;
  }

  get resourceTypePlaceholder(): string {
    const typeMap = {
      'deployment': 'Choose a deployment...',
      'pod': 'Choose a pod...',
      'service': 'Choose a service...',
      'general': ''
    };
    return typeMap[this.resourceType];
  }

  get resourceSelectorLabel(): string {
    const labelMap = {
      'deployment': 'Select Deployment',
      'pod': 'Select Pod', 
      'service': 'Select Service',
      'general': ''
    };
    return labelMap[this.resourceType];
  }
}