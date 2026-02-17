import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { CommandTemplate, K8sCondition, K8sContainerStatus, K8sContainerState } from '../../../shared/models/kubectl.models';

export interface PodStatus {
  name: string;
  namespace: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  conditions: K8sCondition[];
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

  async loadPods(namespace: string) {
    if (!namespace) return;
    
    this.isLoading.set(true);
    try {
      const pods = await this.kubectlService.getResourceNames('pods', namespace);
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
    } else {
      this.templates.set([]);
      this.podStatus.set(null);
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

  private parseContainerStatuses(containerStatuses: K8sContainerStatus[]): ContainerStatus[] {
    return containerStatuses.map(cs => ({
      name: cs.name,
      ready: cs.ready,
      restartCount: cs.restartCount,
      state: this.determineContainerState(cs.state),
      image: cs.image,
      containerID: cs.containerID
    }));
  }

  private determineContainerState(state: K8sContainerState): ContainerStatus['state'] {
    if (state.running) return 'running';
    if (state.waiting) return 'waiting';
    if (state.terminated) return 'terminated';
    return 'waiting';
  }

}