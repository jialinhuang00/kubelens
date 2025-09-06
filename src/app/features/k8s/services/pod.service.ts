import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

export interface PodStatus {
  name: string;
  namespace: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  conditions: any[];
  containers: ContainerStatus[];
  nodeName: string;
  podIP: string;
  startTime: string;
}

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: 'running' | 'waiting' | 'terminated';
  image: string;
  containerID?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PodService {
  private kubectlService = inject(KubectlService);
  private templateService = inject(TemplateService);

  // State
  pods = signal<string[]>([]);
  selectedPod = signal<string>('');
  podStatus = signal<PodStatus | null>(null);
  templates = signal<CommandTemplate[]>([]);
  isLoading = signal<boolean>(false);

  // Log streaming
  logs = signal<string>('');
  isStreamingLogs = signal<boolean>(false);
  private logStreamInterval: any = null;

  async loadPods(namespace: string) {
    if (!namespace) return;
    
    this.isLoading.set(true);
    try {
      const pods = await this.kubectlService.getPods(namespace);
      this.pods.set(pods);
      
      // Clear selection if current pod is not in new list
      if (this.selectedPod() && !pods.includes(this.selectedPod())) {
        this.setSelectedPod('');
      }
    } catch (error) {
      console.error('Failed to load pods:', error);
      this.pods.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  setSelectedPod(pod: string) {
    this.selectedPod.set(pod);
    
    if (pod) {
      // Update templates
      const templates = this.templateService.generatePodTemplates(pod);
      this.templates.set(templates);
      
      // Stop any existing log streaming
      this.stopLogStreaming();
    } else {
      this.templates.set([]);
      this.podStatus.set(null);
      this.stopLogStreaming();
    }
  }

  async getPodStatus(pod: string, namespace: string): Promise<PodStatus | null> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl get pod ${pod} -n ${namespace} -o json`
      );
      
      if (response.success) {
        const data = JSON.parse(response.stdout);
        const status: PodStatus = {
          name: data.metadata.name,
          namespace: data.metadata.namespace,
          phase: data.status.phase,
          conditions: data.status.conditions || [],
          containers: this.parseContainerStatuses(data.status.containerStatuses || []),
          nodeName: data.spec.nodeName || '',
          podIP: data.status.podIP || '',
          startTime: data.status.startTime || ''
        };
        
        this.podStatus.set(status);
        return status;
      }
    } catch (error) {
      console.error('Failed to get pod status:', error);
    }
    
    return null;
  }

  private parseContainerStatuses(containerStatuses: any[]): ContainerStatus[] {
    return containerStatuses.map(cs => ({
      name: cs.name,
      ready: cs.ready,
      restartCount: cs.restartCount,
      state: this.determineContainerState(cs.state),
      image: cs.image,
      containerID: cs.containerID
    }));
  }

  private determineContainerState(state: any): ContainerStatus['state'] {
    if (state.running) return 'running';
    if (state.waiting) return 'waiting';
    if (state.terminated) return 'terminated';
    return 'waiting';
  }

  async startLogStreaming(pod: string, namespace: string, container?: string, follow: boolean = true, tail: number = 100) {
    if (this.isStreamingLogs()) {
      this.stopLogStreaming();
    }

    this.isStreamingLogs.set(true);
    
    // Build command
    let command = `kubectl logs ${pod} -n ${namespace}`;
    if (container) {
      command += ` -c ${container}`;
    }
    if (follow) {
      command += ` --follow`;
    }
    command += ` --tail=${tail}`;

    try {
      // For streaming logs, we'll poll periodically since WebSocket isn't available
      // In a real implementation, you might use kubectl proxy or a WebSocket connection
      await this.updateLogs(pod, namespace, container, tail);
      
      if (follow) {
        this.logStreamInterval = setInterval(async () => {
          await this.updateLogs(pod, namespace, container, tail);
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to start log streaming:', error);
      this.isStreamingLogs.set(false);
    }
  }

  private async updateLogs(pod: string, namespace: string, container?: string, tail: number = 100) {
    try {
      let command = `kubectl logs ${pod} -n ${namespace}`;
      if (container) {
        command += ` -c ${container}`;
      }
      command += ` --tail=${tail}`;

      const response = await this.kubectlService.executeCommand(command);
      if (response.success) {
        this.logs.set(response.stdout);
      }
    } catch (error) {
      console.error('Failed to update logs:', error);
    }
  }

  stopLogStreaming() {
    if (this.logStreamInterval) {
      clearInterval(this.logStreamInterval);
      this.logStreamInterval = null;
    }
    this.isStreamingLogs.set(false);
  }

  async executePodCommand(pod: string, namespace: string, container: string, command: string): Promise<string | null> {
    try {
      const kubectlCommand = `kubectl exec ${pod} -n ${namespace} -c ${container} -- ${command}`;
      const response = await this.kubectlService.executeCommand(kubectlCommand);
      return response.success ? response.stdout : null;
    } catch (error) {
      console.error('Failed to execute pod command:', error);
      return null;
    }
  }

  async portForward(pod: string, namespace: string, localPort: number, podPort: number): Promise<boolean> {
    try {
      // Note: This would typically run in background and return a process handle
      const response = await this.kubectlService.executeCommand(
        `kubectl port-forward ${pod} -n ${namespace} ${localPort}:${podPort}`
      );
      return response.success;
    } catch (error) {
      console.error('Failed to port forward:', error);
      return false;
    }
  }

  async deletePod(pod: string, namespace: string, force: boolean = false): Promise<boolean> {
    try {
      let command = `kubectl delete pod ${pod} -n ${namespace}`;
      if (force) {
        command += ' --force --grace-period=0';
      }
      
      const response = await this.kubectlService.executeCommand(command);
      return response.success;
    } catch (error) {
      console.error('Failed to delete pod:', error);
      return false;
    }
  }

  // Cleanup method
  destroy() {
    this.stopLogStreaming();
  }
}