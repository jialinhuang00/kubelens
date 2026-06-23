import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { K8sCondition } from '../../../shared/models/kubectl.models';
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

export interface RolloutButtonStates {
  pauseEnabled: boolean;
  resumeEnabled: boolean;
  restartEnabled: boolean;
  rollbackEnabled: boolean;
  upgradeEnabled: boolean;
  statusMessage: string;
}

@Injectable({
  providedIn: 'root'
})
export class DeploymentService {
  private kubectlService = inject(KubectlService);
  private executionContext = inject(ExecutionContextService);

  // State
  selectedDeployment = signal<string>('');
  deploymentStatus = signal<DeploymentStatus | null>(null);
  private deploymentStatusMap = signal<Record<string, DeploymentStatus>>({});

  // Rollout monitoring
  private currentMonitoredDeployment: string = '';
  private currentMonitoredNamespace: string = '';

  setSelectedDeployment(deployment: string) {
    this.selectedDeployment.set(deployment);
    if (!deployment) {
      this.deploymentStatus.set(null);
    }
    this.clearRolloutMonitoring();
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

  getStatusForDeployment(deployment: string): DeploymentStatus | null {
    return this.deploymentStatusMap()[deployment] || null;
  }

  async fetchRolloutStatus(deployment: string, namespace: string) {
    this.currentMonitoredDeployment = deployment;
    this.currentMonitoredNamespace = namespace;

    const rolloutGroup = ExecutionGroupGenerator.deploymentOperations(deployment, namespace);
    await this.executionContext.withGroup(rolloutGroup, async () => {
      await this.getDeploymentStatus(deployment, namespace);
    });
  }

  clearRolloutMonitoring() {
    this.currentMonitoredDeployment = '';
    this.currentMonitoredNamespace = '';
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

}