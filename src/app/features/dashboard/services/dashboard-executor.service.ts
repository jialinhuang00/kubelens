import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { KubectlService, StreamingResponse } from '../../../core/services/kubectl.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { KubectlResponse } from '../../../shared/models/kubectl.models';

export interface NormalExecutionResult {
  response?: KubectlResponse;
  cancelled?: boolean;
  networkError?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DashboardExecutorService {
  private kubectlService = inject(KubectlService);
  private executionContext = inject(ExecutionContextService);

  shouldUseStream(command: string): boolean {
    return this.kubectlService.shouldUseStream(command);
  }

  async executeStream(command: string): Promise<StreamingResponse> {
    return this.kubectlService.executeCommandStream(command);
  }

  async executeNormal(command: string, executionGroup: string): Promise<NormalExecutionResult> {
    let result: NormalExecutionResult = {};

    await this.executionContext.withGroup(executionGroup, async () => {
      try {
        result.response = await this.kubectlService.executeCommand(command);
      } catch (error: any) {
        if (error.message === 'REQUEST_CANCELLED') {
          result.cancelled = true;
        } else {
          result.networkError = error.message || String(error);
        }
      }
    });

    return result;
  }
}
