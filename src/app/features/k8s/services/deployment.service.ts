import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

export interface DeploymentStatus {
  name: string;
  namespace: string;
  replicas: {
    ready: number;
    desired: number;
    updated: number;
    available: number;
  };
  status: 'Progressing' | 'Complete' | 'Failed';
  conditions: any[];
}

export interface RolloutStatus {
  deployment: string;
  namespace: string;
  revision: number;
  status: 'InProgress' | 'Complete' | 'Failed' | 'Paused';
  progress: number; // 0-100
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class DeploymentService {
  private kubectlService = inject(KubectlService);
  private templateService = inject(TemplateService);

  // State
  deployments = signal<string[]>([]);
  selectedDeployment = signal<string>('');
  deploymentStatus = signal<DeploymentStatus | null>(null);
  templates = signal<CommandTemplate[]>([]);
  isLoading = signal<boolean>(false);

  // Rollout monitoring
  rolloutStatus = signal<RolloutStatus | null>(null);
  isMonitoringRollout = signal<boolean>(false);
  private rolloutInterval: any = null;

  async loadDeployments(namespace: string) {
    if (!namespace) return;
    
    this.isLoading.set(true);
    try {
      const deployments = await this.kubectlService.getDeployments(namespace);
      this.deployments.set(deployments);
      
      // Clear selection if current deployment is not in new list
      if (this.selectedDeployment() && !deployments.includes(this.selectedDeployment())) {
        this.setSelectedDeployment('');
      }
    } catch (error) {
      console.error('Failed to load deployments:', error);
      this.deployments.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  setSelectedDeployment(deployment: string) {
    this.selectedDeployment.set(deployment);
    
    if (deployment) {
      // Update templates
      const templates = this.templateService.generateDeploymentTemplates(deployment);
      this.templates.set(templates);
      
      // Stop any existing rollout monitoring
      this.stopRolloutMonitoring();
    } else {
      this.templates.set([]);
      this.deploymentStatus.set(null);
      this.stopRolloutMonitoring();
    }
  }

  async getDeploymentStatus(deployment: string, namespace: string): Promise<DeploymentStatus | null> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl get deployment ${deployment} -n ${namespace} -o json`
      );
      
      if (response.success) {
        const data = JSON.parse(response.stdout);
        const status: DeploymentStatus = {
          name: data.metadata.name,
          namespace: data.metadata.namespace,
          replicas: {
            ready: data.status.readyReplicas || 0,
            desired: data.spec.replicas || 0,
            updated: data.status.updatedReplicas || 0,
            available: data.status.availableReplicas || 0
          },
          status: this.determineDeploymentStatus(data.status.conditions || []),
          conditions: data.status.conditions || []
        };
        
        this.deploymentStatus.set(status);
        return status;
      }
    } catch (error) {
      console.error('Failed to get deployment status:', error);
    }
    
    return null;
  }

  async startRolloutMonitoring(deployment: string, namespace: string) {
    if (this.isMonitoringRollout()) {
      this.stopRolloutMonitoring();
    }

    this.isMonitoringRollout.set(true);
    
    // Initial status
    await this.updateRolloutStatus(deployment, namespace);
    
    // Monitor every 2 seconds
    this.rolloutInterval = setInterval(async () => {
      const status = await this.updateRolloutStatus(deployment, namespace);
      
      // Stop monitoring if rollout is complete or failed
      if (status && (status.status === 'Complete' || status.status === 'Failed')) {
        this.stopRolloutMonitoring();
      }
    }, 2000);
  }

  stopRolloutMonitoring() {
    if (this.rolloutInterval) {
      clearInterval(this.rolloutInterval);
      this.rolloutInterval = null;
    }
    this.isMonitoringRollout.set(false);
  }

  private async updateRolloutStatus(deployment: string, namespace: string): Promise<RolloutStatus | null> {
    try {
      // Get rollout status
      const rolloutResponse = await this.kubectlService.executeCommand(
        `kubectl rollout status deployment/${deployment} -n ${namespace} --timeout=1s`
      );
      
      // Get deployment details for progress calculation
      const deploymentStatus = await this.getDeploymentStatus(deployment, namespace);
      
      if (deploymentStatus) {
        let status: RolloutStatus['status'] = 'InProgress';
        let progress = 0;
        let message = rolloutResponse.stdout || rolloutResponse.stderr || '';
        
        // Calculate progress based on replica status
        const { ready, desired } = deploymentStatus.replicas;
        if (desired > 0) {
          progress = Math.round((ready / desired) * 100);
        }
        
        // Determine status
        if (rolloutResponse.success && message.includes('successfully rolled out')) {
          status = 'Complete';
          progress = 100;
        } else if (deploymentStatus.status === 'Failed') {
          status = 'Failed';
        } else if (message.includes('paused')) {
          status = 'Paused';
        }
        
        const rolloutStatus: RolloutStatus = {
          deployment,
          namespace,
          revision: this.extractRevision(deploymentStatus.conditions),
          status,
          progress,
          message: message.trim()
        };
        
        this.rolloutStatus.set(rolloutStatus);
        return rolloutStatus;
      }
    } catch (error) {
      console.error('Failed to get rollout status:', error);
    }
    
    return null;
  }

  private determineDeploymentStatus(conditions: any[]): DeploymentStatus['status'] {
    for (const condition of conditions) {
      if (condition.type === 'Progressing') {
        if (condition.status === 'True' && condition.reason === 'NewReplicaSetAvailable') {
          return 'Complete';
        } else if (condition.status === 'False') {
          return 'Failed';
        } else {
          return 'Progressing';
        }
      }
    }
    return 'Progressing';
  }

  private extractRevision(conditions: any[]): number {
    // Try to extract revision from deployment annotations or conditions
    return 1; // Placeholder - would need to implement proper revision detection
  }

  // Rollout control methods
  async pauseRollout(deployment: string, namespace: string): Promise<boolean> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout pause deployment/${deployment} -n ${namespace}`
      );
      return response.success;
    } catch (error) {
      console.error('Failed to pause rollout:', error);
      return false;
    }
  }

  async resumeRollout(deployment: string, namespace: string): Promise<boolean> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout resume deployment/${deployment} -n ${namespace}`
      );
      return response.success;
    } catch (error) {
      console.error('Failed to resume rollout:', error);
      return false;
    }
  }

  async restartRollout(deployment: string, namespace: string): Promise<boolean> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout restart deployment/${deployment} -n ${namespace}`
      );
      if (response.success) {
        // Start monitoring the new rollout
        this.startRolloutMonitoring(deployment, namespace);
      }
      return response.success;
    } catch (error) {
      console.error('Failed to restart rollout:', error);
      return false;
    }
  }

  async undoRollout(deployment: string, namespace: string): Promise<boolean> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout undo deployment/${deployment} -n ${namespace}`
      );
      if (response.success) {
        // Start monitoring the rollback
        this.startRolloutMonitoring(deployment, namespace);
      }
      return response.success;
    } catch (error) {
      console.error('Failed to undo rollout:', error);
      return false;
    }
  }

  // Cleanup method
  destroy() {
    this.stopRolloutMonitoring();
  }
}