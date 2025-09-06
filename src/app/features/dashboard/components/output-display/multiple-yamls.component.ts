import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YamlDisplayComponent } from '../yaml-display/yaml-display.component';
import { YamlItem } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-multiple-yamls',
  imports: [CommonModule, YamlDisplayComponent],
  templateUrl: './multiple-yamls.component.html',
  styleUrl: './multiple-yamls.component.scss'
})
export class MultipleYamlsComponent {
  @Input() multipleYamls: YamlItem[] = [];
  @Input() expandedYamls: Set<string> = new Set();

  @Output() toggleYamlExpansion = new EventEmitter<string>();

  onToggleYamlExpansion(yamlTitle: string) {
    this.toggleYamlExpansion.emit(yamlTitle);
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.expandedYamls.has(yamlTitle);
  }
}