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
import { UiStateService } from '../services/ui-state.service';
import { RolloutService } from '../services/rollout.service';
import { RolloutStateService } from '../services/rollout-state.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { KubeResource, PodDescribeData, CommandTemplate, TableData, YamlItem } from '../../../shared/models/kubectl.models';
import { CommandSidebarComponent } from './sidebar/command-sidebar.component';
import { OutputDisplayComponent } from './output-display/output-display.component';
import { CommandInputComponent } from './command-input/command-input.component';
import { CommandHistoryComponent } from '../../../shared/components/command-history/command-history.component';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { OutputData } from '../../../shared/interfaces/output-data.interface';
import { SidebarData } from '../../../shared/interfaces/sidebar-data.interface';

@Component({
  selector: 'app-dashboard',
  imports: [RouterOutlet, FormsModule, CommonModule, CommandSidebarComponent, OutputDisplayComponent, CommandInputComponent, CommandHistoryComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  // Service injection - high-level business logic
  private namespaceService = inject(NamespaceService);
  private deploymentService = inject(DeploymentService);
  private podService = inject(PodService);
  private svcService = inject(SvcService);
  private kubectlService = inject(KubectlService);
  private outputParserService = inject(OutputParserService);
  private templateService = inject(TemplateService);
  private uiStateService = inject(UiStateService);
  private rolloutService = inject(RolloutService);
  private rolloutStateService = inject(RolloutStateService);
  private executionContext = inject(ExecutionContextService);

  protected readonly title = signal('kubecmds-viz');

  // High-level business state only
  customCommand = signal<string>('kubectl get pods');
  isLoading = signal<boolean>(false);

  // Command execution results (business data)
  commandOutput = signal<string>('');
  results = signal<KubeResource[]>([]);
  headers = signal<string[]>([]);
  hasEventsTable = signal<boolean>(false);
  yamlContent = signal<string>('');
  outputType = signal<string>('raw');
  podDescribeData = signal<PodDescribeData[]>([]);
  multipleTables = signal<TableData[]>([]);
  multipleYamls = signal<YamlItem[]>([]);

  // Resource selection (high-level business logic)
  selectedNamespace = signal<string>('');
  selectedDeployment = signal<string>('');
  selectedPod = signal<string>('');
  selectedService = signal<string>('');

  // Expose service signals to template
  get namespaces() { return this.namespaceService.namespaces; }
  get deployments() { return this.deploymentService.deployments; }
  get pods() { return this.podService.pods; }
  get services() { return this.svcService.services; }
  get generalTemplates() { return this.templateService.getGeneralTemplates(); }
  get deploymentTemplates() { return this.templateService.generateDeploymentTemplates(this.selectedDeployment()); }
  get rolloutTemplates() { return this.templateService.generateRolloutTemplates(this.selectedDeployment()); }
  get podTemplates() { return this.templateService.generatePodTemplates(this.selectedPod()); }
  get serviceTemplates() { return this.templateService.generateServiceTemplates(this.selectedService()); }
  get isInitializing() { return this.namespaceService.isLoading; }
  get isLoadingNamespaces() { return this.namespaceService.isLoading; }

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

    // Subscribe to rollout actions
    this.rolloutStateService.rolloutAction$.subscribe(event => {
      console.log(`📡 Dashboard received rollout action: ${event.action} for ${event.deployment} in ${event.namespace}`);
    });
  }

  // High-level business logic: Command execution
  async executeCommand(command: string) {
    this.isLoading.set(true);

    // Reset previous data states
    this.results.set([]);
    this.headers.set([]);
    this.commandOutput.set('');
    this.yamlContent.set('');
    this.podDescribeData.set([]);
    this.multipleTables.set([]);
    this.hasEventsTable.set(false);

    // Create execution group for user commands to avoid canceling related background tasks
    console.log('====', 'user commna')
    const userCommandGroup = ExecutionGroupGenerator.userCommand();

    // if need streaming?
    if (this.kubectlService.shouldUseStream(command)) {
      await this.executeCommandWithStream(command);
      return;
    }

    await this.executionContext.withGroup(userCommandGroup, async () => {
      await this.executeCommandNormal(command);
    });
  }

  // High-level business logic: Resource management
  onNamespaceChange(namespace: string | Event) {
    const value = typeof namespace === 'string' ? namespace : (namespace.target as HTMLSelectElement).value;
    this.selectedNamespace.set(value);
    this.selectedDeployment.set(''); // Reset deployment selection when namespace changes
    this.selectedPod.set(''); // Reset pod selection when namespace changes
    this.namespaceService.setCurrentNamespace(value);
    this.loadResourcesForNamespace(value);
  }

  async onDeploymentChange(deployment: string | Event) {
    const value = typeof deployment === 'string' ? deployment : (deployment.target as HTMLSelectElement).value;
    this.selectedDeployment.set(value);
    this.deploymentService.setSelectedDeployment(value);

    // if deployment change, get status and history
    if (value && this.selectedNamespace()) {
      try {
        const deploymentGroup = ExecutionGroupGenerator.deploymentOperations(value, this.selectedNamespace());
        await this.executionContext.withGroup(deploymentGroup, async () => {
          await Promise.all([
            this.deploymentService.getDeploymentStatus(value, this.selectedNamespace()),
            this.deploymentService.getRolloutHistory(value, this.selectedNamespace())
          ]);
        });

        // monitor status for Version Player
        this.deploymentService.startRolloutMonitoring(value, this.selectedNamespace());
      } catch (error) {
        console.error('Failed to load deployment data:', error);
      }
    } else {
      // no deployment, no listening
      this.deploymentService.stopRolloutMonitoring();
    }
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


  private async loadResourcesForNamespace(namespace: string) {
    const resourceGroup = ExecutionGroupGenerator.namespaceResourceLoading(namespace);

    // Use execution context to group all resource loading operations
    await this.executionContext.withGroup(resourceGroup, async () => {
      await Promise.all([
        this.deploymentService.loadDeployments(namespace),
        this.podService.loadPods(namespace),
        this.svcService.loadServices(namespace)
      ]);
    });
  }

  // Computed signals to combine all data for child components
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
    hasEventsTable: this.hasEventsTable()
  }));

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
    deploymentTemplates: this.deploymentTemplates,
    rolloutTemplates: this.rolloutTemplates,
    podTemplates: this.podTemplates,
    serviceTemplates: this.serviceTemplates,
    deploymentStatus: this.deploymentService.deploymentStatus(),
    buttonStates: this.deploymentService.deploymentStatus() ?
      this.deploymentService.getButtonStates(this.deploymentService.deploymentStatus()) : null,
    rolloutHistory: this.deploymentService.rolloutHistory()
  }));

  // Rollout event handlers
  async onImageUpgrade(event: { deployment: string, image: string }) {
    const namespace = this.selectedNamespace();
    if (!namespace) return;

    const command = this.rolloutService.generateSetImageCommand(event.deployment, namespace, event.image);
    await this.executeCommand(command);
  }


  // execute streaming command
  private async executeCommandWithStream(command: string) {
    try {
      console.log(`🔄 Starting stream for: ${command}`);

      const streamResponse = await this.kubectlService.executeCommandStream(command);

      if (!streamResponse.isStreaming || !streamResponse.output$) {
        // fallback to normal way
        console.log('Stream failed, falling back to normal execution');
        await this.executeCommandNormal(command);
        return;
      }

      // streaming mode
      this.outputType.set('streaming');
      this.commandOutput.set('🔄 Starting command stream...\n');

      // subscribe streaming output
      streamResponse.output$.subscribe({
        next: (output) => {
          this.commandOutput.set(output);
          console.log(`📡 Stream update: ${output.length} characters`);
        },
        complete: () => {
          console.log('✅ Stream completed');
          this.isLoading.set(false);
          // share parse function
          this.parseAndSetOutput(this.commandOutput(), command);
        },
        error: (error) => {
          console.error('❌ Stream error:', error);
          this.commandOutput.set(`❌ Stream error: ${error.message}`);
          this.isLoading.set(false);
        }
      });

      // save stop function for UI usage
      (window as any).currentStreamStop = streamResponse.stop;

    } catch (error) {
      console.error('❌ Stream setup error:', error);
      // fallback to normal way
      await this.executeCommandNormal(command);
    }
  }

  private parseAndSetOutput(stdout: string, command: string) {
    const parsedOutput = this.outputParserService.parseCommandOutput(stdout, command);

    switch (parsedOutput.type) {
      case 'multiple-tables':
        this.multipleTables.set(parsedOutput.tables || []);
        // Auto-expand tables through service
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

  private async executeCommandNormal(command: string) {
    this.multipleYamls.set([]);

    // Reset UI states through service
    this.uiStateService.resetOutputStates();

    let wasCancelled = false;

    try {
      const response = await this.kubectlService.executeCommand(command);

      if (response.success) {
        this.parseAndSetOutput(response.stdout, command);
      } else {
        this.outputType.set('raw');
        this.commandOutput.set(`Error: ${response.error}`);
      }
    } catch (error: any) {
      // If request was cancelled, don't show error - just keep loading state
      if (error.message === 'REQUEST_CANCELLED') {
        console.log('🚫 Request was cancelled, keeping loading state');
        wasCancelled = true;
        return;
      }

      // Handle real errors
      this.outputType.set('raw');
      this.commandOutput.set(`Network error: ${error.message || error}`);
    } finally {
      // Only set loading to false if request wasn't cancelled
      if (!wasCancelled) {
        this.isLoading.set(false);
      }
    }
  }

}