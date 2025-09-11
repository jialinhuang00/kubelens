import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { RolloutService } from './rollout.service';
import { DeploymentService } from '../../k8s/services/deployment.service';
import { NamespaceService } from '../../k8s/services/namespace.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';

export interface RolloutActionEvent {
  action: string;
  deployment: string;
  namespace: string;
}

@Injectable({
  providedIn: 'root'
})
export class RolloutStateService {
  private rolloutService = inject(RolloutService);
  private deploymentService = inject(DeploymentService);
  private namespaceService = inject(NamespaceService);
  private executionContext = inject(ExecutionContextService);
  
  private rolloutActionSubject = new Subject<RolloutActionEvent>();
  rolloutAction$ = this.rolloutActionSubject.asObservable();

  async triggerRolloutAction(action: string) {
    const deployment = this.deploymentService.selectedDeployment();
    const namespace = this.namespaceService.currentNamespace();

    if (!deployment || !namespace) {
      console.warn('Cannot trigger rollout action: missing deployment or namespace');
      return;
    }

    console.log(`🔄 Rollout action triggered: ${action} for ${deployment} in ${namespace}`);
    
    const event: RolloutActionEvent = {
      action,
      deployment,
      namespace
    };
    
    this.rolloutActionSubject.next(event);

    // Execute the rollout logic that was previously in dashboard.component
    setTimeout(async () => {
      try {
        await this.refreshDeploymentStatus(deployment, namespace);
      } catch (error) {
        console.error('Error refreshing rollout data:', error);
      }
    }, 1000); // Wait a second for kubectl
  }

  private async refreshDeploymentStatus(deployment: string, namespace: string) {
    try {
      const refreshGroup = `refresh-status-${deployment}-${namespace}-${Date.now()}`;
      await this.executionContext.withGroup(refreshGroup, async () => {
        await Promise.all([
          this.deploymentService.getDeploymentStatus(deployment, namespace),
          this.deploymentService.getRolloutHistory(deployment, namespace)
        ]);
      });
      console.log(`✅ Status updated after rollout action`);
    } catch (error) {
      console.error('❌ Failed to update status after rollout action:', error);
    }
  }

  private async refreshRolloutHistory(deployment: string, namespace: string) {
    // This method is now handled in refreshDeploymentStatus
    // Keeping it for backward compatibility or if needed separately later
  }
}