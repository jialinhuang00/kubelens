import { Injectable, inject } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { KubectlResponse } from '../../../shared/models/kubectl.models';

@Injectable({
  providedIn: 'root'
})
export class RolloutService {
  private kubectlService = inject(KubectlService);

  executeRolloutCommand(command: string): Promise<KubectlResponse> {
    return this.kubectlService.executeCommand(command);
  }

  generateSetImageCommand(deployment: string, container: string, namespace: string, image: string): string {
    return `kubectl set image deployment/${deployment} ${container}=${image} -n ${namespace}`;
  }

}