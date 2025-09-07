import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableOutputComponent } from './table-output.component';
import { EventsDisplayComponent } from './events-display.component';
import { RawOutputComponent } from './raw-output.component';
import { MultipleTablesComponent } from './multiple-tables.component';
import { MultipleYamlsComponent } from './multiple-yamls.component';
import { PodDetailsComponent } from './pod-details.component';
import { YamlDisplayComponent } from '../yaml-display/yaml-display.component';
import { OutputData } from '../../../../shared/interfaces/output-data.interface';
import { UiStateService } from '../../services/ui-state.service';

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
  
  private uiStateService = inject(UiStateService);

  @Output() copyToClipboard = new EventEmitter<{ text: string, event?: Event }>();

  // UI state now handled internally via service
  get expandedPods() { return this.uiStateService.expandedPodsState; }
  get expandedTables() { return this.uiStateService.expandedTablesState; }
  get expandedYamls() { return this.uiStateService.expandedYamlsState; }
  get isResourceDetailsExpanded() { return this.uiStateService.isResourceDetailsExpandedState; }

  onTogglePodDetails(podName: string) {
    this.uiStateService.togglePodDetails(podName);
  }

  onToggleTable(tableTitle: string) {
    this.uiStateService.toggleTable(tableTitle);
  }

  onToggleYamlExpansion(yamlTitle: string) {
    this.uiStateService.toggleYamlExpansion(yamlTitle);
  }

  onToggleResourceDetails() {
    this.uiStateService.toggleResourceDetails();
  }

  onCopyToClipboard(text: string, event?: Event) {
    this.copyToClipboard.emit({ text, event });
  }

  isPodExpanded(podName: string): boolean {
    return this.uiStateService.isPodExpanded(podName);
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.uiStateService.isTableExpanded(tableTitle);
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.uiStateService.isYamlExpanded(yamlTitle);
  }
}