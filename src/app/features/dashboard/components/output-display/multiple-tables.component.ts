import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableData } from '../../../../shared/models/kubectl.models';
import { ClipboardService } from '../../../../shared/services/clipboard.service';

@Component({
  selector: 'app-multiple-tables',
  imports: [CommonModule],
  templateUrl: './multiple-tables.component.html',
  styleUrl: './multiple-tables.component.scss'
})
export class MultipleTablesComponent {
  private clipboardService = inject(ClipboardService);
  
  @Input() multipleTables: TableData[] = [];
  @Input() expandedTables: Set<string> = new Set();

  @Output() toggleTable = new EventEmitter<string>();

  onToggleTable(tableTitle: string) {
    this.toggleTable.emit(tableTitle);
  }

  async onCopyToClipboard(text: string, event?: Event): Promise<void> {
    await this.clipboardService.copyToClipboard(text, event);
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.expandedTables.has(tableTitle);
  }
}