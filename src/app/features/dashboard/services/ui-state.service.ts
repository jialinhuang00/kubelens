import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UiStateService {
  // Output display states
  private expandedPods = signal<Set<string>>(new Set());
  private expandedTables = signal<Set<string>>(new Set());
  private expandedYamls = signal<Set<string>>(new Set());
  private isResourceDetailsExpanded = signal<boolean>(false);

  // Sidebar accordion states
  private isGeneralExpanded = signal<boolean>(false);
  private isDeploymentExpanded = signal<boolean>(false);
  private isPodSectionExpanded = signal<boolean>(false);
  private isServiceSectionExpanded = signal<boolean>(false);

  // Public readonly signals
  readonly expandedPodsState = this.expandedPods.asReadonly();
  readonly expandedTablesState = this.expandedTables.asReadonly();
  readonly expandedYamlsState = this.expandedYamls.asReadonly();
  readonly isResourceDetailsExpandedState = this.isResourceDetailsExpanded.asReadonly();
  readonly isGeneralExpandedState = this.isGeneralExpanded.asReadonly();
  readonly isDeploymentExpandedState = this.isDeploymentExpanded.asReadonly();
  readonly isPodSectionExpandedState = this.isPodSectionExpanded.asReadonly();
  readonly isServiceSectionExpandedState = this.isServiceSectionExpanded.asReadonly();

  // Output display methods
  toggleResourceDetails() {
    this.isResourceDetailsExpanded.set(!this.isResourceDetailsExpanded());
  }

  togglePodDetails(podName: string) {
    const expanded = this.expandedPods();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(podName)) {
      newExpanded.delete(podName);
    } else {
      newExpanded.add(podName);
    }
    this.expandedPods.set(newExpanded);
  }

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

  // Sidebar methods
  toggleGeneralSection() {
    this.isGeneralExpanded.set(!this.isGeneralExpanded());
  }

  toggleDeploymentSection() {
    this.isDeploymentExpanded.set(!this.isDeploymentExpanded());
  }

  togglePodSection() {
    this.isPodSectionExpanded.set(!this.isPodSectionExpanded());
  }

  toggleServiceSection() {
    this.isServiceSectionExpanded.set(!this.isServiceSectionExpanded());
  }

  // Utility methods
  isPodExpanded(podName: string): boolean {
    return this.expandedPods().has(podName);
  }

  isTableExpanded(tableTitle: string): boolean {
    return this.expandedTables().has(tableTitle);
  }

  isYamlExpanded(yamlTitle: string): boolean {
    return this.expandedYamls().has(yamlTitle);
  }

  // Reset methods for when new data loads
  resetOutputStates() {
    this.expandedPods.set(new Set());
    this.expandedTables.set(new Set());
    this.expandedYamls.set(new Set());
    this.isResourceDetailsExpanded.set(false);
  }

  // Auto-expand tables when multiple tables are loaded
  autoExpandTables(tableNames: string[]) {
    this.expandedTables.set(new Set(tableNames));
  }

  // Copy to clipboard utility (moved from component)
  async copyToClipboard(text: string, event?: Event): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);

      // Add success animation
      if (event?.target) {
        const button = event.target as HTMLElement;
        button.classList.add('copied');
        setTimeout(() => {
          button.classList.remove('copied');
        }, 600);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  }
}