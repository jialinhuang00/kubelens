import { Component, inject, signal, effect, OnInit, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NamespaceService } from '../../../k8s/services/namespace.service';
import { ResourceTreeService } from '../../services/resource-tree.service';
import { PanelManagerService } from '../../services/panel-manager.service';
import { PanelExecutionService } from '../../services/panel-execution.service';
import { TemplateService } from '../../../dashboard/services/template.service';
import { DataModeService } from '../../../../core/services/data-mode.service';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-terminal-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './terminal-sidebar.component.html',
  styleUrl: './terminal-sidebar.component.scss',
})
export class TerminalSidebarComponent implements OnInit {
  private namespaceService = inject(NamespaceService);
  protected resourceTree = inject(ResourceTreeService);
  private panelManager = inject(PanelManagerService);
  private panelExecution = inject(PanelExecutionService);
  private templateService = inject(TemplateService);
  protected dataModeService = inject(DataModeService);
  private destroyRef = inject(DestroyRef);

  namespaces = this.namespaceService.namespaces;
  selectedNamespace = signal('');
  namespaceFilter = signal('');
  customCommand = signal('');

  filteredNamespaces = signal<string[]>([]);

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

  private filterEffect = effect(() => {
    const filter = this.namespaceFilter().toLowerCase();
    const all = this.namespaces();
    this.filteredNamespaces.set(
      filter ? all.filter(ns => ns.toLowerCase().includes(filter)) : all
    );
  });

  async ngOnInit(): Promise<void> {
    this.dataModeService.refreshAvailability();
    await this.namespaceService.loadNamespaces();
  }

  async onSelectNamespace(ns: string): Promise<void> {
    if (this.selectedNamespace() === ns) return;
    this.selectedNamespace.set(ns);
    this.namespaceService.setCurrentNamespace(ns);
    this.panelManager.closeAll();
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

  onExecuteCustomCommand(): void {
    const cmd = this.customCommand().trim();
    if (!cmd) return;
    const panelId = this.panelManager.openGeneralPanel();
    this.panelExecution.execute(panelId, cmd);
  }

  onQuickAction(action: string): void {
    const ns = this.selectedNamespace();
    let command = '';
    switch (action) {
      case 'get-all':
        command = ns ? `kubectl get all -n '${ns}'` : 'kubectl get all --all-namespaces';
        break;
      case 'events':
        command = ns ? `kubectl get events -n '${ns}' --sort-by=.lastTimestamp` : 'kubectl get events --all-namespaces --sort-by=.lastTimestamp';
        break;
      case 'nodes':
        command = 'kubectl get nodes -o wide';
        break;
    }
    if (!command) return;
    const panelId = this.panelManager.openGeneralPanel();
    this.panelExecution.execute(panelId, command);
  }

  onCommandKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.onExecuteCustomCommand();
    }
  }

  private getTemplatesForKind(kind: string, name: string): CommandTemplate[] {
    switch (kind) {
      case 'Deployment': return this.templateService.generateDeploymentTemplates(name);
      case 'Pod': return this.templateService.generatePodTemplates(name);
      case 'Service': return this.templateService.generateServiceTemplates(name);
      case 'StatefulSet': return this.templateService.generateStatefulSetTemplates(name);
      case 'CronJob': return this.templateService.generateCronJobTemplates(name);
      case 'Job': return this.templateService.generateJobTemplates(name);
      case 'ConfigMap': return this.templateService.generateConfigMapTemplates(name);
      case 'Secret': return this.templateService.generateSecretTemplates(name);
      case 'PVC': return this.templateService.generatePVCTemplates(name);
      case 'ServiceAccount': return this.templateService.generateServiceAccountTemplates(name);
      case 'Ingress': return this.templateService.generateIngressTemplates(name);
      default: return [];
    }
  }
}
