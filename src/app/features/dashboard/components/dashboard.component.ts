import { Component, signal, inject, OnInit, effect, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NamespaceService } from '../../k8s/services/namespace.service';
import { DeploymentService } from '../../k8s/services/deployment.service';
import { PodService } from '../../k8s/services/pod.service';
import { SvcService } from '../../k8s/services/svc.service';
import { KubectlService } from '../../../core/services/kubectl.service';
import { OutputParserService } from '../services/output-parser.service';
import { TemplateService } from '../services/template.service';
import { KubeResource, PodDescribeData, CommandTemplate, TableData, YamlItem } from '../../../shared/models/kubectl.models';
import { CommandDisplayDirective } from '../../../shared/directives/command-display.directive';
import { YamlDisplayComponent } from './yaml-display/yaml-display.component';
import { CommandSidebarComponent } from './sidebar/command-sidebar.component';
import { OutputDisplayComponent } from './output-display/output-display.component';
import { OutputData } from '../../../shared/interfaces/output-data.interface';
import { SidebarData } from '../../../shared/interfaces/sidebar-data.interface';

@Component({
  selector: 'app-dashboard',
  imports: [RouterOutlet, FormsModule, CommonModule, CommandDisplayDirective, YamlDisplayComponent, CommandSidebarComponent, OutputDisplayComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private namespaceService = inject(NamespaceService);
  private deploymentService = inject(DeploymentService);
  private podService = inject(PodService);
  private svcService = inject(SvcService);
  private kubectlService = inject(KubectlService);
  private outputParserService = inject(OutputParserService);
  private templateService = inject(TemplateService);
  protected readonly title = signal('kubecmds-viz');

  constructor() {
    // Auto-select first namespace when namespaces load
    effect(() => {
      const namespaces = this.namespaceService.namespaces();
      if (namespaces.length > 0 && !this.selectedNamespace()) {
        this.selectedNamespace.set(namespaces[0]);
        this.namespaceService.setCurrentNamespace(namespaces[0]);
        this.loadResourcesForNamespace(namespaces[0]);
      }
    });
  }

  async ngOnInit() {
    await this.namespaceService.loadNamespaces();
    // Resources will be loaded automatically by the effect when first namespace is selected
  }

  customCommand = signal<string>('kubectl get pods -n default -o wide');
  results = signal<KubeResource[]>([]);
  isLoading = signal<boolean>(false);
  commandOutput = signal<string>('');
  headers = signal<string[]>([]);
  hasEventsTable = signal<boolean>(false);
  isResourceDetailsExpanded = signal<boolean>(false);
  yamlContent = signal<string>('');
  outputType = signal<string>('raw');
  podDescribeData = signal<PodDescribeData[]>([]);
  expandedPods = signal<Set<string>>(new Set());
  selectedNamespace = signal<string>('');
  selectedDeployment = signal<string>('');
  selectedPod = signal<string>('');
  selectedService = signal<string>('');
  multipleTables = signal<TableData[]>([]);
  expandedTables = signal<Set<string>>(new Set());
  multipleYamls = signal<YamlItem[]>([]);
  expandedYamls = signal<Set<string>>(new Set());

  // Accordion states
  isGeneralExpanded = signal<boolean>(false);
  isDeploymentExpanded = signal<boolean>(false);
  isPodSectionExpanded = signal<boolean>(false);
  isServiceSectionExpanded = signal<boolean>(false);

  // Expose service signals to template
  get namespaces() { return this.namespaceService.namespaces; }
  get deployments() { return this.deploymentService.deployments; }
  get pods() { return this.podService.pods; }
  get services() { return this.svcService.services; }
  get generalTemplates() { return this.templateService.getGeneralTemplates(); }
  get deploymentTemplates() { return this.deploymentService.templates; }
  get podTemplates() { return this.podService.templates; }
  get serviceTemplates() { return this.svcService.templates; }
  get isInitializing() { return this.namespaceService.isLoading; }
  get isLoadingNamespaces() { return this.namespaceService.isLoading; }

  private loadResourcesForNamespace(namespace: string) {
    if (!namespace) return;
    this.deploymentService.loadDeployments(namespace);
    this.podService.loadPods(namespace);
    this.svcService.loadServices(namespace);
  }

  onCustomCommandChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.customCommand.set(target.value.trim());
  }

  onCommandInputKeyDown(event: KeyboardEvent) {
    // Check for Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux)
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); // Prevent default form submission
      if (!this.isLoading()) {
        this.executeCustomCommand();
      }
    }
  }

  async executeCustomCommand() {
    const command = this.customCommand();
    if (!command.trim()) return;

    this.isLoading.set(true);
    this.commandOutput.set('');
    this.results.set([]);
    this.hasEventsTable.set(false);
    this.isResourceDetailsExpanded.set(false);
    this.podDescribeData.set([]);
    this.yamlContent.set('');
    this.outputType.set('raw');
    this.expandedPods.set(new Set());
    this.multipleTables.set([]);
    this.expandedTables.set(new Set());
    this.multipleYamls.set([]);
    this.expandedYamls.set(new Set());

    try {
      const response = await this.kubectlService.executeCommand(command);

      if (response.success) {
        const parsedOutput = this.outputParserService.parseCommandOutput(response.stdout, command);

        switch (parsedOutput.type) {
          case 'multiple-tables':
            this.multipleTables.set(parsedOutput.tables || []);
            // Expand all tables by default
            const allTableTitles = new Set(parsedOutput.tables?.map(t => t.title) || []);
            this.expandedTables.set(allTableTitles);
            this.outputType.set('multiple-tables');
            break;
          case 'multiple-yamls':
            this.multipleYamls.set(parsedOutput.yamls || []);
            // Expand all YAMLs by default
            const allYamlTitles = new Set(parsedOutput.yamls?.map(y => y.title) || []);
            // this.expandedYamls.set(allYamlTitles);
            this.outputType.set('multiple-yamls');
            break;
          case 'table':
            this.headers.set(parsedOutput.headers || []);
            this.results.set(parsedOutput.data || []);
            this.outputType.set('table');
            break;
          case 'events':
            this.commandOutput.set(parsedOutput.rawOutput || '');
            this.headers.set(parsedOutput.headers || []);
            this.results.set(parsedOutput.data || []);
            this.hasEventsTable.set(false);
            this.outputType.set('events');
            break;
          case 'multiple-pods':
            this.podDescribeData.set(parsedOutput.podData || []);
            this.outputType.set('multiple-pods');
            break;
          case 'yaml':
            this.yamlContent.set(parsedOutput.yamlContent || '');
            this.outputType.set('yaml');
            break;
          case 'raw':
          default:
            this.commandOutput.set(parsedOutput.rawOutput || '');
            this.outputType.set('raw');
            break;
        }
      } else {
        this.commandOutput.set(`Error: ${response.error}\n${response.stderr || ''}`);
      }
    } catch (error) {
      console.error('Command execution failed:', error);
      this.commandOutput.set('Error executing command');
    } finally {
      this.isLoading.set(false);
    }
  }

  onNamespaceChange(namespace: string | Event) {
    const value = typeof namespace === 'string' ? namespace : (namespace.target as HTMLSelectElement).value;
    this.selectedNamespace.set(value);
    this.selectedDeployment.set(''); // Reset deployment selection when namespace changes
    this.selectedPod.set(''); // Reset pod selection when namespace changes
    this.namespaceService.setCurrentNamespace(value);
    this.loadResourcesForNamespace(value);
  }

  onDeploymentChange(deployment: string | Event) {
    const value = typeof deployment === 'string' ? deployment : (deployment.target as HTMLSelectElement).value;
    this.selectedDeployment.set(value);
    this.deploymentService.setSelectedDeployment(value);
  }

  onPodChange(pod: string | Event) {
    const value = typeof pod === 'string' ? pod : (pod.target as HTMLSelectElement).value;
    this.selectedPod.set(value);
    this.podService.setSelectedPod(value);
  }

  onServiceChange(service: string | Event) {
    const value = typeof service === 'string' ? service : (service.target as HTMLSelectElement).value;
    this.selectedService.set(value);
    this.svcService.setSelectedService(value);
  }

  executeTemplate(template: CommandTemplate) {
    const command = this.templateService.replaceNamespacePlaceholder(template.command, this.selectedNamespace());
    this.customCommand.set(command);
    this.executeCustomCommand();
  }

  onCommandSelect(event: Event) {
    const target = event.target as HTMLSelectElement;
    if (target.value) {
      this.customCommand.set(target.value);
    }
  }

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

  isPodExpanded(podName: string): boolean {
    return this.expandedPods().has(podName);
  }

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

  isTableExpanded(tableTitle: string): boolean {
    return this.expandedTables().has(tableTitle);
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

  isYamlExpanded(yamlTitle: string): boolean {
    return this.expandedYamls().has(yamlTitle);
  }

  async copyToClipboard(text: string, event?: Event) {
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

  // Computed signal to combine all output data
  outputData = computed<OutputData>(() => ({
    outputType: this.outputType() as any,
    isLoading: this.isLoading(),
    results: this.results(),
    headers: this.headers(),
    yamlContent: this.yamlContent(),
    multipleTables: this.multipleTables(),
    multipleYamls: this.multipleYamls(),
    podDescribeData: this.podDescribeData(),
    commandOutput: this.commandOutput(),
    customCommand: this.customCommand(),
    hasEventsTable: this.hasEventsTable(),
    expandedTables: this.expandedTables(),
    expandedYamls: this.expandedYamls(),
    expandedPods: this.expandedPods(),
    isResourceDetailsExpanded: this.isResourceDetailsExpanded()
  }));

  // Computed signal to combine all sidebar data
  sidebarData = computed<SidebarData>(() => ({
    namespaces: this.namespaces(),
    selectedNamespace: this.selectedNamespace(),
    deployments: this.deployments(),
    selectedDeployment: this.selectedDeployment(),
    pods: this.pods(),
    selectedPod: this.selectedPod(),
    services: this.services(),
    selectedService: this.selectedService(),
    isInitializing: this.isInitializing(),
    isLoadingNamespaces: this.isLoadingNamespaces(),
    generalTemplates: this.generalTemplates,
    deploymentTemplates: this.deploymentTemplates(),
    podTemplates: this.podTemplates(),
    serviceTemplates: this.serviceTemplates(),
    isGeneralExpanded: this.isGeneralExpanded(),
    isDeploymentExpanded: this.isDeploymentExpanded(),
    isPodSectionExpanded: this.isPodSectionExpanded(),
    isServiceSectionExpanded: this.isServiceSectionExpanded()
  }));
}