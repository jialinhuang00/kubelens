import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableData } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-multiple-tables',
  imports: [CommonModule],
  templateUrl: './multiple-tables.component.html',
  styleUrl: './multiple-tables.component.scss'
})
export class MultipleTablesComponent {
  @Input() multipleTables: TableData[] = [];
  @Input() expandedTables: Set<string> = new Set();

  @Output() toggleTable = new EventEmitter<string>();
  @Output() copyToClipboard = new EventEmitter<{ text: string, event?: Event }>();

  onToggleTable(tableTitle: string) {
    this.toggleTable.emit(tableTitle);
  }

  onCopyToClipboard(text: string, event?: Event) {
    this.copyToClipboard.emit({ text, event });
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.expandedTables.has(tableTitle);
  }
}