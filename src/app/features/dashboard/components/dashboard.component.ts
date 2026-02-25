import { Component, signal, inject, OnInit, effect, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NamespaceService } from '../../k8s/services/namespace.service';
import { DeploymentService } from '../../k8s/services/deployment.service';
import { PodService } from '../../k8s/services/pod.service';
import { SvcService } from '../../k8s/services/svc.service';
import { GenericResourceService } from '../../k8s/services/generic-resource.service';
import { ResourceType, OutputType } from '../../../shared/models/kubectl.models';
import { KubectlService } from '../../../core/services/kubectl.service';
import { DashboardExecutorService } from '../services/dashboard-executor.service';
import { OutputParserService } from '../services/output-parser.service';
import { TemplateService } from '../services/template.service';
import { UiStateService } from '../services/ui-state.service';
import { RolloutService } from '../services/rollout.service';
import { RolloutStateService } from '../services/rollout-state.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { KubeResource, PodDescribeData, CommandTemplate, TableData, YamlItem } from '../../../shared/models/kubectl.models';
import { ContextBarComponent, ResourceDropdown } from './context-bar/context-bar.component';
import { CommandChipsComponent, ChipGroup } from './command-chips/command-chips.component';
import { OutputDisplayComponent } from './output-display/output-display.component';
import { CommandInputComponent } from './command-input/command-input.component';
import { ExecutionDialogComponent } from '../../../shared/components/execution-dialog/execution-dialog.component';
import { ExecutionDialogService } from '../../../core/services/execution-dialog.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { OutputData } from '../../../shared/interfaces/output-data.interface';
import { DataModeService } from '../../../core/services/data-mode.service';
import { ModeToggleComponent } from '../../../shared/components/mode-toggle/mode-toggle.component';
import { EcrService } from '../../k8s/services/ecr.service';

// Resource config: defines all resource types, their labels, colors, and template generators
interface ResourceConfig {
  key: string;
  label: string;
  color: string;
  type: 'builtin' | 'generic';
  genericType?: ResourceType;
  templateGenerator: (selected: string) => CommandTemplate[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterOutlet, FormsModule, CommonModule, ContextBarComponent, CommandChipsComponent, OutputDisplayComponent, CommandInputComponent, ExecutionDialogComponent, ModeToggleComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private namespaceService = inject(NamespaceService);
  private deploymentService = inject(DeploymentService);
  private podService = inject(PodService);
  private svcService = inject(SvcService);
  private genericResourceService = inject(GenericResourceService);
  private kubectlService = inject(KubectlService);
  private executor = inject(DashboardExecutorService);
  private outputParserService = inject(OutputParserService);
  private templateService = inject(TemplateService);
  private uiStateService = inject(UiStateService);
  private rolloutService = inject(RolloutService);
  private rolloutStateService = inject(RolloutStateService);
  private executionContext = inject(ExecutionContextService);
  private dialogService = inject(ExecutionDialogService);
  protected dataModeService = inject(DataModeService);
  protected ecrService = inject(EcrService);
  private destroyRef = inject(DestroyRef);

  protected readonly title = signal('kubecmds-viz');

  customCommand = signal<string>('kubectl get pods');
  isLoading = signal<boolean>(false);
  isStreaming = signal<boolean>(false);
  private activeStreamStop: (() => Promise<void>) | null = null;

  // True only when a user-initiated command is running
  isBusy = computed(() => this.isLoading());

  // Command execution results
  commandOutput = signal<string>('');
  results = signal<KubeResource[]>([]);
  headers = signal<string[]>([]);
  hasEventsTable = signal<boolean>(false);
  yamlContent = signal<string>('');
  outputType = signal<OutputType>('raw');
  podDescribeData = signal<PodDescribeData[]>([]);
  multipleTables = signal<TableData[]>([]);
  multipleYamls = signal<YamlItem[]>([]);

  // Resource selection
  selectedNamespace = signal<string>('');
  selectedDeployment = signal<string>('');
  selectedPod = signal<string>('');
  selectedService = signal<string>('');

  // Resource counts (from /api/resource-counts — lightweight, no full item lists)
  resourceCounts = signal<Record<string, number>>({});

  // ECR: current deployment's container image (derived from deployment status)
  deploymentImage = computed(() => this.deploymentService.deploymentStatus()?.containerImage || '');

  // Service signal accessors
  get namespaces() { return this.namespaceService.namespaces; }
  get isInitializing() { return this.namespaceService.isLoading; }
  get rolloutTemplates() { return this.templateService.generateRolloutTemplates(this.selectedDeployment()); }

  // Rollout-related computed signals
  deploymentStatus = computed(() => this.deploymentService.deploymentStatus());
  buttonStates = computed(() => {
    const status = this.deploymentService.deploymentStatus();
    return status ? this.deploymentService.getButtonStates(status) : null;
  });
  rolloutHistory = computed(() => this.deploymentService.rolloutHistory());
  isRolloutConsoleExpanded = computed(() => this.uiStateService.isRolloutConsoleExpandedState());

  // All resource configs — single source of truth
  readonly resourceConfigs: ResourceConfig[] = [
    {
      key: 'deployment', label: 'Deployment', color: '#e8b866', type: 'builtin',
      templateGenerator: (s) => this.templateService.generateDeploymentTemplates(s)
    },
    {
      key: 'pod', label: 'Pod', color: '#f0d080', type: 'builtin',
      templateGenerator: (s) => this.templateService.generatePodTemplates(s)
    },
    {
      key: 'service', label: 'Service', color: '#d4956a', type: 'builtin',
      templateGenerator: (s) => this.templateService.generateServiceTemplates(s)
    },
    {
      key: 'statefulsets', label: 'StatefulSet', color: '#e0a050', type: 'generic', genericType: 'statefulsets',
      templateGenerator: (s) => this.templateService.generateStatefulSetTemplates(s)
    },
    {
      key: 'cronjobs', label: 'CronJob', color: '#c8a060', type: 'generic', genericType: 'cronjobs',
      templateGenerator: (s) => this.templateService.generateCronJobTemplates(s)
    },
    {
      key: 'jobs', label: 'Job', color: '#b89860', type: 'generic', genericType: 'jobs',
      templateGenerator: (s) => this.templateService.generateJobTemplates(s)
    },
    {
      key: 'configmaps', label: 'ConfigMap', color: '#a0b880', type: 'generic', genericType: 'configmaps',
      templateGenerator: (s) => this.templateService.generateConfigMapTemplates(s)
    },
    {
      key: 'secrets', label: 'Secret', color: '#c0a8a0', type: 'generic', genericType: 'secrets',
      templateGenerator: (s) => this.templateService.generateSecretTemplates(s)
    },
    {
      key: 'persistentvolumeclaims', label: 'PVC', color: '#90b0c8', type: 'generic', genericType: 'persistentvolumeclaims',
      templateGenerator: (s) => this.templateService.generatePVCTemplates(s)
    },
    {
      key: 'serviceaccounts', label: 'ServiceAccount', color: '#a8a0c0', type: 'generic', genericType: 'serviceaccounts',
      templateGenerator: (s) => this.templateService.generateServiceAccountTemplates(s)
    },
    {
      key: 'ingresses', label: 'Ingress', color: '#80c0b0', type: 'generic', genericType: 'ingresses',
      templateGenerator: (s) => this.templateService.generateIngressTemplates(s)
    },
    {
      key: 'gateways', label: 'Gateway', color: '#70b8a8', type: 'generic', genericType: 'gateways',
      templateGenerator: (s) => this.templateService.generateGatewayTemplates(s)
    },
    {
      key: 'httproutes', label: 'HTTPRoute', color: '#68b0a0', type: 'generic', genericType: 'httproutes',
      templateGenerator: (s) => this.templateService.generateHTTPRouteTemplates(s)
    },
  ];

  // Computed: resource dropdowns for context bar
  resourceDropdowns = computed<ResourceDropdown[]>(() => {
    return this.resourceConfigs.map(cfg => ({
      key: cfg.key,
      label: cfg.label,
      items: this.getResourceItems(cfg),
      selected: this.getResourceSelected(cfg),
      isLoading: this.getResourceIsLoading(cfg),
    }));
  });

  // Global commands (above context bar — no namespace dependency)
  globalChipGroup = computed<ChipGroup[]>(() => [
    {
      key: 'global', label: 'Global', resourceName: '', color: '#6dca82',
      templates: this.templateService.getGlobalTemplates()
    },
  ]);

  // Resource-specific commands (below context bar)
  // Only show namespace group (always) + resource groups that have an active selection
  resourceChipGroups = computed<ChipGroup[]>(() => {
    const groups: ChipGroup[] = [
      {
        key: 'namespace', label: 'Namespace', resourceName: this.selectedNamespace(), color: '#6dca82',
        templates: this.templateService.getNamespaceTemplates()
      },
    ];
    for (const cfg of this.resourceConfigs) {
      const selected = this.getResourceSelected(cfg);
      // Only include if user has selected a specific resource from the dropdown
      if (!selected) continue;
      const templates = cfg.templateGenerator(selected);
      if (templates.length > 0) {
        groups.push({
          key: cfg.key,
          label: cfg.label,
          resourceName: selected,
          color: cfg.color,
          templates,
        });
      }
    }
    return groups;
  });

  private getResourceItems(cfg: ResourceConfig): string[] {
    if (cfg.type === 'builtin') {
      switch (cfg.key) {
        case 'deployment': return this.deploymentService.deployments();
        case 'pod': return this.podService.pods();
        case 'service': return this.svcService.services();
      }
    }
    return cfg.genericType ? this.genericResourceService.getItems(cfg.genericType)() : [];
  }

  private getResourceSelected(cfg: ResourceConfig): string {
    if (cfg.type === 'builtin') {
      switch (cfg.key) {
        case 'deployment': return this.selectedDeployment();
        case 'pod': return this.selectedPod();
        case 'service': return this.selectedService();
      }
    }
    return cfg.genericType ? this.genericResourceService.getSelected(cfg.genericType)() : '';
  }

  private getResourceIsLoading(cfg: ResourceConfig): boolean {
    if (cfg.type === 'builtin') return false; // builtin resources load eagerly
    return cfg.genericType ? this.genericResourceService.getIsLoading(cfg.genericType)() : false;
  }

  constructor() {
  }

  private prevMode: boolean | null = null;
  private modeEffect = effect(() => {
    const mode = this.dataModeService.isSnapshotMode();
    // Skip initial run and only reload when mode actually changes
    if (this.prevMode !== null && mode !== this.prevMode) {
      this.reloadAfterModeSwitch();
    }
    this.prevMode = mode;
  });

  private async reloadAfterModeSwitch(): Promise<void> {
    this.selectedNamespace.set('');
    this.selectedDeployment.set('');
    this.selectedPod.set('');
    this.selectedService.set('');

    // Clear output
    this.results.set([]);
    this.headers.set([]);
    this.commandOutput.set('');
    this.yamlContent.set('');
    this.podDescribeData.set([]);
    this.multipleTables.set([]);
    this.multipleYamls.set([]);
    this.hasEventsTable.set(false);
    this.outputType.set('raw');

    // Stop active stream if any
    if (this.isStreaming()) {
      await this.stopStream();
    }

    await this.namespaceService.loadNamespaces();
  }

  async ngOnInit() {
    this.dataModeService.refreshAvailability();
    await this.namespaceService.loadNamespaces();

    this.rolloutStateService.rolloutAction$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(event => {
      console.log(`Dashboard received rollout action: ${event.action} for ${event.deployment} in ${event.namespace}`);
    });
  }

  // Resource change handlers
  onNamespaceChange(namespace: string | Event) {
    const value = typeof namespace === 'string' ? namespace : (namespace.target as HTMLSelectElement).value;
    this.selectedNamespace.set(value);
    this.selectedDeployment.set('');
    this.selectedPod.set('');
    this.selectedService.set('');
    this.genericResourceService.resetAllSelections();
    this.namespaceService.setCurrentNamespace(value);
    this.loadResourcesForNamespace(value);
  }

  onResourceChange(event: { key: string; value: string }) {
    const { key, value } = event;

    switch (key) {
      case 'deployment':
        this.onDeploymentChange(value);
        break;
      case 'pod':
        this.selectedPod.set(value);
        this.podService.setSelectedPod(value);
        break;
      case 'service':
        this.selectedService.set(value);
        this.svcService.setSelectedService(value);
        break;
      default:
        // Generic resource
        const cfg = this.resourceConfigs.find(c => c.key === key);
        if (cfg?.genericType) {
          this.genericResourceService.setSelected(cfg.genericType, value);
        }
        break;
    }
  }

  onDeploymentChange(deployment: string | Event) {
    const value = typeof deployment === 'string' ? deployment : (deployment.target as HTMLSelectElement).value;
    this.selectedDeployment.set(value);
    this.deploymentService.setSelectedDeployment(value);
    this.ecrService.clear();

    if (!value) {
      this.deploymentService.clearRolloutMonitoring();
      return;
    }

    // Auto-select matching pod and service if none selected
    this.autoSelectRelatedResources(value);

    // Fetch deployment status once (for deploymentImage computed signal + button states)
    const namespace = this.selectedNamespace();
    if (namespace) {
      this.deploymentService.getDeploymentStatus(value, namespace);
    }
  }

  private autoSelectRelatedResources(deployment: string) {
    // Auto-select first matching pod (pod names typically start with deployment name)
    if (!this.selectedPod()) {
      const matchingPod = this.podService.pods().find(p => p.startsWith(deployment));
      if (matchingPod) {
        this.selectedPod.set(matchingPod);
        this.podService.setSelectedPod(matchingPod);
      }
    }

    // Auto-select first matching service (often same name as deployment)
    if (!this.selectedService()) {
      const services = this.svcService.services();
      const exactMatch = services.find(s => s === deployment);
      const prefixMatch = services.find(s => s.startsWith(deployment) || deployment.startsWith(s));
      const match = exactMatch || prefixMatch;
      if (match) {
        this.selectedService.set(match);
        this.svcService.setSelectedService(match);
      }
    }
  }


  async onLoadEcrTags() {
    const image = this.deploymentImage();
    if (!image) return;
    await this.ecrService.fetchTags(image);
  }

  async onEcrTagSelect(tag: string) {
    const image = this.deploymentImage();
    const deployment = this.selectedDeployment();
    const namespace = this.selectedNamespace();
    if (!image || !deployment || !namespace) return;

    // Build full image URL with new tag
    const imageBase = image.replace(/:.*$/, '');
    const fullImage = `${imageBase}:${tag}`;
    const command = this.rolloutService.generateSetImageCommand(deployment, namespace, fullImage);
    await this.executeCommand(command);
  }

  onToggleRolloutConsole() {
    this.uiStateService.toggleRolloutConsole();

    const deployment = this.selectedDeployment();
    const namespace = this.selectedNamespace();
    if (!deployment || !namespace) return;

    if (this.isRolloutConsoleExpanded()) {
      this.deploymentService.fetchRolloutStatus(deployment, namespace);
    } else {
      this.deploymentService.clearRolloutMonitoring();
    }
  }

  onRefetchRolloutStatus() {
    this.deploymentService.refetchRolloutStatus();
  }

  // Command execution
  async executeCommand(command: string) {
    this.isLoading.set(true);
    this.results.set([]);
    this.headers.set([]);
    this.commandOutput.set('');
    this.yamlContent.set('');
    this.podDescribeData.set([]);
    this.multipleTables.set([]);
    this.hasEventsTable.set(false);

    const userCommandGroup = ExecutionGroupGenerator.userCommand();

    if (this.executor.shouldUseStream(command)) {
      await this.executeCommandWithStream(command);
      return;
    }

    await this.executeCommandNormal(command, userCommandGroup);
  }

  executeCustomCommand() {
    this.executeCommand(this.customCommand());
  }

  executeTemplate(template: CommandTemplate) {
    const substitutedCommand = this.templateService.substituteTemplate(
      template.command,
      this.selectedNamespace(),
      this.selectedDeployment(),
      this.selectedPod(),
      this.selectedService()
    );
    this.customCommand.set(substitutedCommand);
    this.executeCommand(substitutedCommand);
  }

  onCustomCommandChange(value: string) {
    this.customCommand.set(value);
  }

  onCommandInputKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.executeCustomCommand();
    }
  }

  async onImageUpgrade(event: { deployment: string, image: string }) {
    const namespace = this.selectedNamespace();
    if (!namespace) return;
    const command = this.rolloutService.generateSetImageCommand(event.deployment, namespace, event.image);
    await this.executeCommand(command);
  }

  private async loadResourcesForNamespace(namespace: string) {
    const resourceGroup = ExecutionGroupGenerator.namespaceResourceLoading(namespace);

    // Fetch resource counts immediately (lightweight, single request)
    this.kubectlService.getResourceCounts(namespace).then(counts => {
      this.resourceCounts.set(counts);
    });

    // Only load builtin resources eagerly; generic resources load lazily on expand
    this.genericResourceService.resetAll();
    await this.executionContext.withGroup(resourceGroup, async () => {
      await Promise.all([
        this.deploymentService.loadDeployments(namespace),
        this.podService.loadPods(namespace),
        this.svcService.loadServices(namespace),
      ]);
    });
  }

  // Lazy load: triggered when user expands a resource panel in context-bar
  async onResourceExpand(key: string) {
    const namespace = this.selectedNamespace();
    if (!namespace) return;

    const cfg = this.resourceConfigs.find(c => c.key === key);
    if (!cfg) return;

    // Builtin resources are already loaded eagerly
    if (cfg.type === 'builtin') return;

    // Generic: load if not already loaded
    if (cfg.genericType) {
      const items = this.genericResourceService.getItems(cfg.genericType)();
      const isLoading = this.genericResourceService.getIsLoading(cfg.genericType)();
      if (items.length === 0 && !isLoading) {
        await this.genericResourceService.loadResource(cfg.genericType, namespace);
      }
    }
  }

  // Refetch a single resource type — clear selection first
  async onResourceRefetch(key: string) {
    const namespace = this.selectedNamespace();
    if (!namespace) return;

    const cfg = this.resourceConfigs.find(c => c.key === key);
    if (!cfg) return;

    // Clear selection for this resource (triggers template/output cleanup)
    this.onResourceChange({ key, value: '' });

    // Stop active stream if running (e.g. logs -f on a pod that may no longer exist)
    if (this.isStreaming()) {
      await this.stopStream();
    }

    if (cfg.type === 'builtin') {
      switch (key) {
        case 'deployment': await this.deploymentService.loadDeployments(namespace); break;
        case 'pod': await this.podService.loadPods(namespace); break;
        case 'service': await this.svcService.loadServices(namespace); break;
      }
    } else if (cfg.genericType) {
      await this.genericResourceService.loadResource(cfg.genericType, namespace);
    }
  }

  outputData = computed<OutputData>(() => ({
    outputType: this.outputType(),
    isLoading: this.isLoading(),
    results: this.results(),
    headers: this.headers(),
    yamlContent: this.yamlContent(),
    multipleTables: this.multipleTables(),
    multipleYamls: this.multipleYamls(),
    podDescribeData: this.podDescribeData(),
    commandOutput: this.commandOutput(),
    customCommand: this.customCommand(),
    hasEventsTable: this.hasEventsTable()
  }));

  async stopStream() {
    if (this.activeStreamStop) {
      await this.activeStreamStop();
      this.activeStreamStop = null;
    }
    this.isStreaming.set(false);
    this.isLoading.set(false);
  }

  private async executeCommandWithStream(command: string) {
    try {
      const streamResponse = await this.executor.executeStream(command);

      if (!streamResponse.isStreaming || !streamResponse.output$) {
        await this.executeCommandNormal(command);
        return;
      }

      this.outputType.set('streaming');
      this.isStreaming.set(true);
      this.activeStreamStop = streamResponse.stop || null;
      this.commandOutput.set('');

      streamResponse.output$.subscribe({
        next: (output) => this.commandOutput.set(output),
        complete: () => {
          this.isStreaming.set(false);
          this.activeStreamStop = null;
          this.isLoading.set(false);
          this.parseAndSetOutput(this.commandOutput(), command);
        },
        error: (error) => {
          this.commandOutput.set(`Stream error: ${error.message}`);
          this.isStreaming.set(false);
          this.activeStreamStop = null;
          this.isLoading.set(false);
        }
      });

    } catch (error) {
      await this.executeCommandNormal(command);
    }
  }

  private parseAndSetOutput(stdout: string, command: string) {
    const parsedOutput = this.outputParserService.parseCommandOutput(stdout, command);

    switch (parsedOutput.type) {
      case 'multiple-tables':
        this.multipleTables.set(parsedOutput.tables || []);
        const tableNames = parsedOutput.tables?.map(t => t.title) || [];
        this.uiStateService.autoExpandTables(tableNames);
        this.outputType.set('multiple-tables');
        break;
      case 'multiple-yamls':
        this.multipleYamls.set(parsedOutput.yamls || []);
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
  }

  private async executeCommandNormal(command: string, executionGroup?: string) {
    this.multipleYamls.set([]);
    this.uiStateService.resetOutputStates();

    try {
      const group = executionGroup || ExecutionGroupGenerator.userCommand();
      const result = await this.executor.executeNormal(command, group);

      if (result.cancelled) return;

      if (result.networkError) {
        this.outputType.set('raw');
        this.commandOutput.set(`Network error: ${result.networkError}`);
      } else if (result.response) {
        if (result.response.success) {
          this.parseAndSetOutput(result.response.stdout, command);
        } else {
          this.outputType.set('raw');
          this.commandOutput.set(`Error: ${result.response.error}`);
        }
      }
    } finally {
      this.isLoading.set(false);
    }
  }
}
