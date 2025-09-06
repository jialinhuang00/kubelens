import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableOutputComponent } from './table-output.component';
import { EventsDisplayComponent } from './events-display.component';
import { RawOutputComponent } from './raw-output.component';
import { MultipleTablesComponent } from './multiple-tables.component';
import { MultipleYamlsComponent } from './multiple-yamls.component';
import { PodDetailsComponent } from './pod-details.component';
import { YamlDisplayComponent } from '../yaml-display/yaml-display.component';
import { OutputData } from '../../../../shared/interfaces/output-data.interface';

@Component({
  selector: 'app-output-display',
  imports: [
    CommonModule,
    TableOutputComponent,
    EventsDisplayComponent,
    RawOutputComponent,
    MultipleTablesComponent,
    MultipleYamlsComponent,
    PodDetailsComponent,
    YamlDisplayComponent
  ],
  templateUrl: './output-display.component.html',
  styleUrl: './output-display.component.scss'
})
export class OutputDisplayComponent {
  @Input() data!: OutputData;

  @Output() togglePodDetails = new EventEmitter<string>();
  @Output() toggleTable = new EventEmitter<string>();
  @Output() toggleYamlExpansion = new EventEmitter<string>();
  @Output() toggleResourceDetails = new EventEmitter<void>();
  @Output() copyToClipboard = new EventEmitter<{ text: string, event?: Event }>();

  onTogglePodDetails(podName: string) {
    this.togglePodDetails.emit(podName);
  }

  onToggleTable(tableTitle: string) {
    this.toggleTable.emit(tableTitle);
  }

  onToggleYamlExpansion(yamlTitle: string) {
    this.toggleYamlExpansion.emit(yamlTitle);
  }

  onToggleResourceDetails() {
    this.toggleResourceDetails.emit();
  }

  onCopyToClipboard(text: string, event?: Event) {
    this.copyToClipboard.emit({ text, event });
  }

  isPodExpanded(podName: string): boolean {
    return this.data?.expandedPods?.has(podName) ?? false;
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.data?.expandedTables?.has(tableTitle) ?? false;
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.data?.expandedYamls?.has(yamlTitle) ?? false;
  }
}