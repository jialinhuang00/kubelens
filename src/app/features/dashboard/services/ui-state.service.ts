import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UiStateService {
  // Output display states
  private expandedTables = signal<Set<string>>(new Set());
  private expandedYamls = signal<Set<string>>(new Set());

  // Public readonly signals
  readonly expandedTablesState = this.expandedTables.asReadonly();
  readonly expandedYamlsState = this.expandedYamls.asReadonly();

  toggleTable(tableTitle: string) {
    const expanded = this.expandedTables();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(tableTitle)) {
      newExpanded.delete(tableTitle);
    } else {
      newExpanded.add(tableTitle);
    }
    this.expandedTables.set(newExpanded);
  }

  toggleYamlExpansion(yamlTitle: string) {
    const expanded = this.expandedYamls();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(yamlTitle)) {
      newExpanded.delete(yamlTitle);
    } else {
      newExpanded.add(yamlTitle);
    }
    this.expandedYamls.set(newExpanded);
  }

  // Utility methods
  isTableExpanded(tableTitle: string): boolean {
    return this.expandedTables().has(tableTitle);
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.expandedYamls().has(yamlTitle);
  }

}
