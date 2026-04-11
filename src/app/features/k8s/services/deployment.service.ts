import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { CommandTemplate, K8sCondition } from '../../../shared/models/kubectl.models';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';

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
  conditions: K8sCondition[];
  isPaused: boolean;
  progressingReason?: string; // DeploymentPaused, ReplicaSetUpdated, NewReplicaSetAvailable, etc.
  containerImage?: string; // first container image URL
  containerName?: string; // first container name (NOT always equal to deployment name)
}

export interface RolloutStatus {
  deployment: string;
  namespace: string;
  revision: number;
  status: 'InProgress' | 'Complete' | 'Failed' | 'Paused';
  progress: number; // 0-100
  message: string;
}

export interface RolloutButtonStates {
  pauseEnabled: boolean;
  resumeEnabled: boolean;
  restartEnabled: boolean;
  rollbackEnabled: boolean;
  upgradeEnabled: boolean;
  statusMessage: string;
}

export interface RolloutHistoryItem {
  revision: number;
  changeCause: string;
  image: string; // trying
  created: string;
}

@Injectable({
  providedIn: 'root'
})
export class DeploymentService {
  private kubectlService = inject(KubectlService);
  private templateService = inject(TemplateService);
  private executionContext = inject(ExecutionContextService);

  // State
  deployments = signal<string[]>([]);
  selectedDeployment = signal<string>('');
  deploymentStatus = signal<DeploymentStatus | null>(null);
  private deploymentStatusMap = signal<Record<string, DeploymentStatus>>({});
  rolloutHistory = signal<RolloutHistoryItem[]>([]);
  templates = signal<CommandTemplate[]>([]);
  isLoading = signal<boolean>(false);

  // Rollout monitoring
  rolloutStatus = signal<RolloutStatus | null>(null);
  isMonitoringRollout = signal<boolean>(false);
  private lastHistoryUpdate: number = 0;
  private currentMonitoredDeployment: string = '';
  private currentMonitoredNamespace: string = '';

  async loadDeployments(namespace: string) {
    if (!namespace) return;

    this.isLoading.set(true);
    try {
      const deployments = await this.kubectlService.getResourceNames('deployments', namespace);
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
      this.clearRolloutMonitoring();
    } else {
      this.templates.set([]);
      this.deploymentStatus.set(null);
      this.rolloutHistory.set([]);
      this.clearRolloutMonitoring();
    }
  }

  async getDeploymentStatus(deployment: string, namespace: string): Promise<DeploymentStatus | null> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl get deployment ${deployment} -n ${namespace} -o json`
      );
      if (response.success) {
        const data = JSON.parse(response.stdout);
        const progressingCondition = this.findProgressingCondition(data.status.conditions || []);
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
          conditions: data.status.conditions || [],
          isPaused: data.spec.paused === true,
          progressingReason: progressingCondition?.reason,
          containerImage: data.spec?.template?.spec?.containers?.[0]?.image || '',
          containerName: data.spec?.template?.spec?.containers?.[0]?.name || ''
        };

        this.deploymentStatus.set(status);
        this.deploymentStatusMap.update(map => ({ ...map, [deployment]: status }));
        return status;
      }
    } catch (error) {
      console.error('Failed to get deployment status:', error);
    }

    return null;
  }

  async getRolloutHistory(deployment: string, namespace: string): Promise<RolloutHistoryItem[]> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout history deployment/${deployment} -n ${namespace}`
      );

      if (response.success) {
        return this.parseRolloutHistory(response.stdout, deployment, namespace);
      }
    } catch (error) {
      console.error('Failed to get rollout history:', error);
    }

    return [];
  }

  private async parseRolloutHistory(output: string, deployment: string, namespace: string): Promise<RolloutHistoryItem[]> {
    const lines = output.split('\n');
    const historyItems: RolloutHistoryItem[] = [];

    // skip title, find REVISION
    let dataStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('REVISION') && lines[i].includes('CHANGE-CAUSE')) {
        dataStartIndex = i + 1;
        break;
      }
    }

    if (dataStartIndex === -1) return historyItems;

    // parse REVISION
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const revision = parseInt(parts[0]);
        const changeCause = parts.slice(1).join(' ') || '<none>';

        // get image
        const image = await this.getImageForRevision(deployment, namespace, revision);

        historyItems.push({
          revision,
          changeCause,
          image: image || 'Unknown',
          created: 'Unknown' // kubectl rollout history doesn't provider createdAt
        });
      }
    }

    this.rolloutHistory.set(historyItems);
    return historyItems;
  }

  private async getImageForRevision(deployment: string, namespace: string, revision: number): Promise<string | null> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl rollout history deployment/${deployment} -n ${namespace} --revision=${revision}`
      );

      if (response.success) {
        const lines = response.stdout.split('\n');
        for (const line of lines) {
          if (line.includes('Image:')) {
            const match = line.match(/Image:\s*(.+)/);
            if (match) {
              return match[1].trim();
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to get image for revision ${revision}:`, error);
    }

    return null;
  }

  getStatusForDeployment(deployment: string): DeploymentStatus | null {
    return this.deploymentStatusMap()[deployment] || null;
  }

  async fetchRolloutStatus(deployment: string, namespace: string) {
    this.currentMonitoredDeployment = deployment;
    this.currentMonitoredNamespace = namespace;
    this.isMonitoringRollout.set(true);

    const rolloutGroup = ExecutionGroupGenerator.deploymentOperations(deployment, namespace);
    await this.executionContext.withGroup(rolloutGroup, async () => {
      await this.getDeploymentStatus(deployment, namespace);
    });
  }

  async refetchRolloutStatus() {
    if (!this.currentMonitoredDeployment || !this.currentMonitoredNamespace) return;
    await this.fetchRolloutStatus(this.currentMonitoredDeployment, this.currentMonitoredNamespace);
  }

  clearRolloutMonitoring() {
    this.currentMonitoredDeployment = '';
    this.currentMonitoredNamespace = '';
    this.isMonitoringRollout.set(false);
  }

  private findProgressingCondition(conditions: K8sCondition[]): K8sCondition | null {
    return conditions.find(condition => condition.type === 'Progressing') || null;
  }

  private determineDeploymentStatus(conditions: K8sCondition[]): DeploymentStatus['status'] {
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

  // check which buttons sohuld be enable by deployment status
  getButtonStates(deploymentStatus: DeploymentStatus | null): RolloutButtonStates {
    if (!deploymentStatus) {
      return {
        pauseEnabled: false,
        resumeEnabled: false,
        restartEnabled: false,
        rollbackEnabled: false,
        upgradeEnabled: false,
        statusMessage: 'No deployment selected'
      };
    }

    const { isPaused, progressingReason, status, replicas } = deploymentStatus;

    let pauseEnabled = false;
    let resumeEnabled = false;
    let statusMessage = '';

    if (isPaused) {
      // only resume no pause
      pauseEnabled = false;
      resumeEnabled = true;
      statusMessage = '🟡 Deployment is paused';
    } else {
      // according to progressingReason
      switch (progressingReason) {
        case 'NewReplicaSetAvailable':
          // stable, pause is allowed maybe prepare for next rollout.
          // stable, now there is no pending rollout to resume.
          pauseEnabled = true;
          resumeEnabled = false; // no paused rollout to be resumed
          statusMessage = '🟢 Deployment is stable - can pause to prevent next rollout';
          break;

        case 'ReplicaSetUpdated':
        case 'FoundNewReplicaSet':
          // rolling out now, pause is ok, but no resume
          pauseEnabled = true;
          resumeEnabled = false;
          statusMessage = '🔄 Rollout in progress - can be paused';
          break;

        case 'DeploymentPaused':
          // theoretically isPaused is true, but.. just in case
          pauseEnabled = false;
          resumeEnabled = true;
          statusMessage = '🟡 Deployment is paused';
          break;

        default:
          // unknown
          pauseEnabled = true;
          resumeEnabled = false;
          statusMessage = `❓ Status: ${progressingReason || 'Unknown'} - operations available`;
          break;
      }
    }

    const restartEnabled = !isPaused;
    const rollbackEnabled = !isPaused;
    const upgradeEnabled = !isPaused;

    return {
      pauseEnabled,
      resumeEnabled,
      restartEnabled,
      rollbackEnabled,
      upgradeEnabled,
      statusMessage
    };
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
        this.fetchRolloutStatus(deployment, namespace);
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
        this.fetchRolloutStatus(deployment, namespace);
      }
      return response.success;
    } catch (error) {
      console.error('Failed to undo rollout:', error);
      return false;
    }
  }

}