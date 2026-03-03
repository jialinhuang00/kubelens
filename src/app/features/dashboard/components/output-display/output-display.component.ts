import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableOutputComponent } from './table-output.component';
import { RawOutputComponent } from './raw-output.component';
import { MultipleTablesComponent } from './multiple-tables.component';
import { MultipleYamlsComponent } from './multiple-yamls.component';
import { YamlDisplayComponent } from '../yaml-display/yaml-display.component';
import { OutputData } from '../../../../shared/interfaces/output-data.interface';
import { UiStateService } from '../../services/ui-state.service';

@Component({
  selector: 'app-output-display',
  imports: [
    CommonModule,
    TableOutputComponent,
    RawOutputComponent,
    MultipleTablesComponent,
    MultipleYamlsComponent,
    YamlDisplayComponent
  ],
  templateUrl: './output-display.component.html',
  styleUrl: './output-display.component.scss'
})
export class OutputDisplayComponent {
  @Input() data!: OutputData;
  
  private uiStateService = inject(UiStateService);

  // UI state now handled internally via service
  get expandedTables() { return this.uiStateService.expandedTablesState; }
  get expandedYamls() { return this.uiStateService.expandedYamlsState; }
  onToggleTable(tableTitle: string) {
    this.uiStateService.toggleTable(tableTitle);
  }

  onToggleYamlExpansion(yamlTitle: string) {
    this.uiStateService.toggleYamlExpansion(yamlTitle);
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.uiStateService.isTableExpanded(tableTitle);
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.uiStateService.isYamlExpanded(yamlTitle);
  }
}