import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { KubectlService } from '../../../core/services/kubectl.service';
import { OutputParserService } from '../../dashboard/services/output-parser.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { PanelManagerService } from './panel-manager.service';
import { ResourceTreeService } from './resource-tree.service';
import { NamespaceService } from '../../k8s/services/namespace.service';
import { EMPTY_OUTPUT_DATA } from '../models/panel.models';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { ExecutionContextService } from '../../../core/services/execution-context.service';

const MUTATION_PATTERNS = [
  /kubectl\s+set\s+/,
  /kubectl\s+scale\s+/,
  /kubectl\s+rollout\s+(restart|undo|pause|resume)/,
  /kubectl\s+apply\s+/,
  /kubectl\s+create\s+/,
  /kubectl\s+delete\s+/,
  /kubectl\s+patch\s+/,
  /kubectl\s+label\s+/,
  /kubectl\s+annotate\s+/,
  /kubectl\s+edit\s+/,
  /kubectl\s+cordon\s+/,
  /kubectl\s+uncordon\s+/,
  /kubectl\s+drain\s+/,
  /kubectl\s+taint\s+/,
];

@Injectable({ providedIn: 'root' })
export class PanelExecutionService {
  private kubectlService = inject(KubectlService);
  private outputParser = inject(OutputParserService);
  private templateService = inject(TemplateService);
  private panelManager = inject(PanelManagerService);
  private executionContext = inject(ExecutionContextService);
  private snackBar = inject(MatSnackBar);
  private resourceTree = inject(ResourceTreeService);
  private namespaceService = inject(NamespaceService);

  async execute(panelId: string, command: string): Promise<void> {
    const panel = this.panelManager.getPanel(panelId);
    if (!panel) return;

    // Stop existing stream if any
    await this.stopStream(panelId);

    // Reset output state
    this.panelManager.updatePanelOutput(panelId, {
      isLoading: true,
      isStreaming: false,
      activeCommand: command,
      outputData: { ...EMPTY_OUTPUT_DATA, isLoading: true, customCommand: command },
    });

    if (this.kubectlService.shouldUseStream(command)) {
      await this.executeStream(panelId, command);
    } else {
      await this.executeNormal(panelId, command);
    }
  }

  async stopStream(panelId: string): Promise<void> {
    const panel = this.panelManager.getPanel(panelId);
    if (!panel?.streamStop) return;

    await panel.streamStop();
    this.panelManager.updatePanelOutput(panelId, {
      isStreaming: false,
      isLoading: false,
      streamStop: null,
      streamClear: null,
    });
  }

  substituteCommand(command: string, namespace: string, resourceName: string): string {
    // Use template service substitution — pass resourceName for all resource slots
    return this.templateService.substituteTemplate(command, namespace, resourceName, resourceName, resourceName);
  }

  private async executeStream(panelId: string, command: string): Promise<void> {
    try {
      const streamResponse = await this.kubectlService.executeCommandStream(command);

      if (!streamResponse.isStreaming || !streamResponse.output$) {
        await this.executeNormal(panelId, command);
        return;
      }

      this.panelManager.updatePanelOutput(panelId, {
        isStreaming: true,
        streamStop: streamResponse.stop || null,
        streamClear: streamResponse.clear || null,
        outputData: {
          ...EMPTY_OUTPUT_DATA,
          outputType: 'streaming',
          isLoading: false,
          commandOutput: '',
          customCommand: command,
        },
      });

      streamResponse.output$.subscribe({
        next: (output) => {
          this.panelManager.updatePanelOutput(panelId, {
            outputData: {
              ...EMPTY_OUTPUT_DATA,
              outputType: 'streaming',
              isLoading: false,
              commandOutput: output,
              customCommand: command,
            },
          });
        },
        complete: () => {
          const current = this.panelManager.getPanel(panelId);
          const finalOutput = current?.outputData.commandOutput || '';
          const parsed = this.parseOutput(finalOutput, command);

          this.panelManager.updatePanelOutput(panelId, {
            isStreaming: false,
            isLoading: false,
            streamStop: null,
            streamClear: null,
            outputData: { ...parsed, customCommand: command },
          });
          this.notifyIfMutation(command);
        },
        error: (error) => {
          this.panelManager.updatePanelOutput(panelId, {
            isStreaming: false,
            isLoading: false,
            streamStop: null,
            streamClear: null,
            outputData: {
              ...EMPTY_OUTPUT_DATA,
              outputType: 'raw',
              commandOutput: `Stream error: ${error.message}`,
              customCommand: command,
            },
          });
        },
      });
    } catch {
      await this.executeNormal(panelId, command);
    }
  }

  private async executeNormal(panelId: string, command: string): Promise<void> {
    const group = ExecutionGroupGenerator.userCommand();

    try {
      const response = await this.executionContext.withGroup(group, () =>
        this.kubectlService.executeCommand(command)
      );

      if (response.success) {
        const parsed = this.parseOutput(response.stdout, command);
        this.panelManager.updatePanelOutput(panelId, {
          isLoading: false,
          outputData: { ...parsed, customCommand: command },
        });
        this.notifyIfMutation(command);
      } else {
        this.panelManager.updatePanelOutput(panelId, {
          isLoading: false,
          outputData: {
            ...EMPTY_OUTPUT_DATA,
            outputType: 'raw',
            commandOutput: `Error: ${response.error}`,
            customCommand: command,
          },
        });
      }
    } catch (error: any) {
      if (error.message === 'REQUEST_CANCELLED') return;
      this.panelManager.updatePanelOutput(panelId, {
        isLoading: false,
        outputData: {
          ...EMPTY_OUTPUT_DATA,
          outputType: 'raw',
          commandOutput: `Network error: ${error.message || String(error)}`,
          customCommand: command,
        },
      });
    }
  }

  private parseOutput(stdout: string, command: string) {
    const parsed = this.outputParser.parseCommandOutput(stdout, command);
    const out = { ...EMPTY_OUTPUT_DATA, isLoading: false };

    switch (parsed.type) {
      case 'multiple-tables':
        out.outputType = 'multiple-tables';
        out.multipleTables = parsed.tables || [];
        break;
      case 'multiple-yamls':
        out.outputType = 'multiple-yamls';
        out.multipleYamls = parsed.yamls || [];
        break;
      case 'table':
        out.outputType = 'table';
        out.headers = parsed.headers || [];
        out.results = parsed.data || [];
        break;
      case 'yaml':
        out.outputType = 'yaml';
        out.yamlContent = parsed.yamlContent || '';
        break;
      default:
        out.outputType = 'raw';
        out.commandOutput = parsed.rawOutput || '';
        break;
    }

    return out;
  }

  private notifyIfMutation(command: string): void {
    if (!MUTATION_PATTERNS.some(p => p.test(command))) return;

    const ref = this.snackBar.open('Cluster state changed', 'Reload', {
      duration: 6000,
      panelClass: 'mutation-snackbar',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });

    ref.onAction().subscribe(() => {
      const ns = this.namespaceService.currentNamespace();
      if (ns) {
        this.resourceTree.loadForNamespace(ns);
      }
    });
  }
}
