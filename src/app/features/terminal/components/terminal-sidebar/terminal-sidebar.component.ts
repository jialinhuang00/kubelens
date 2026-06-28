import { Component, inject, signal, effect, OnInit, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NamespaceChipsComponent } from '../../../../shared/components/namespace-chips/namespace-chips.component';
import { NamespaceService } from '../../../k8s/services/namespace.service';
import { ResourceTreeService } from '../../services/resource-tree.service';
import { PanelManagerService } from '../../services/panel-manager.service';
import { TemplateService } from '../../../dashboard/services/template.service';
import { DataModeService } from '../../../../core/services/data-mode.service';
import { isOfficialGroup } from '../../../../core/services/config.service';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-terminal-sidebar',
  standalone: true,
  imports: [CommonModule, NamespaceChipsComponent],
  templateUrl: './terminal-sidebar.component.html',
  styleUrl: './terminal-sidebar.component.scss',
})
export class TerminalSidebarComponent implements OnInit {
  private namespaceService = inject(NamespaceService);
  protected resourceTree = inject(ResourceTreeService);
  private panelManager = inject(PanelManagerService);
  private templateService = inject(TemplateService);
  protected dataModeService = inject(DataModeService);
  private destroyRef = inject(DestroyRef);

  namespaces = this.namespaceService.namespaces;
  nsLoading = this.namespaceService.isLoading;
  nsError = this.namespaceService.error;

  /** Show the API group on a tree node only for third-party CRDs (official groups stay clean). */
  protected showDomain(group: string): boolean {
    return !isOfficialGroup(group);
  }
  selectedNamespace = signal('');

  private prevMode: boolean | null = null;
  private modeEffect = effect(() => {
    const mode = this.dataModeService.isSnapshotMode();
    if (this.prevMode !== null && mode !== this.prevMode) {
      this.selectedNamespace.set('');
      this.panelManager.closeAll();
      this.namespaceService.loadNamespaces();
    }
    this.prevMode = mode;
  });

  async ngOnInit(): Promise<void> {
    this.dataModeService.refreshAvailability();
    await this.namespaceService.loadNamespaces();
  }

  async onSelectNamespace(ns: string): Promise<void> {
    if (this.selectedNamespace() === ns) return;
    this.selectedNamespace.set(ns);
    this.namespaceService.setCurrentNamespace(ns);
    this.panelManager.setNamespaceContext(ns);
    this.panelManager.restoreState(ns, (kind, name) => this.getTemplatesForKind(kind, name));
    await this.resourceTree.loadForNamespace(ns);
  }

  onToggleKind(kind: string): void {
    const ns = this.selectedNamespace();
    if (!ns) return;
    this.resourceTree.toggleKind(kind, ns);
  }

  isItemChecked(kind: string, name: string): boolean {
    return this.panelManager.hasPanel(`${kind}:${name}`);
  }

  isItemInOtherWorkspace(kind: string, name: string): boolean {
    return this.panelManager.isInOtherWorkspace(`${kind}:${name}`);
  }

  getItemWorkspaceLabel(kind: string, name: string): string {
    const ws = this.panelManager.getPanelWorkspace(`${kind}:${name}`);
    return ws >= 0 ? `W${ws + 1}` : '';
  }

  onToggleItem(kind: string, name: string): void {
    const id = `${kind}:${name}`;
    if (this.panelManager.hasPanel(id)) {
      const panel = this.panelManager.getPanel(id);
      if (panel?.streamStop) {
        panel.streamStop();
      }
      this.panelManager.closePanel(id);
    } else {
      const templates = this.getTemplatesForKind(kind, name);
      this.panelManager.openResourcePanel(kind, name, this.selectedNamespace(), templates);
    }
  }

  onRefetchKind(kind: string): void {
    const ns = this.selectedNamespace();
    if (ns) {
      this.resourceTree.reloadKind(kind, ns);
    }
  }

  private getTemplatesForKind(kind: string, name: string): CommandTemplate[] {
    // Templates are config-driven now (kubelens.default.yaml `templates`, keyed by Kind).
    return this.templateService.getTemplates(kind, name);
  }
}
