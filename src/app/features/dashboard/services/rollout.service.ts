import { Injectable, inject } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { KubectlResponse } from '../../../shared/models/kubectl.models';

interface RolloutHistoryItem {
  revision: number;
  image: string;
  status: string;
  created: string;
}

@Injectable({
  providedIn: 'root'
})
export class RolloutService {
  private kubectlService = inject(KubectlService);

  executeRolloutCommand(command: string): Promise<KubectlResponse> {
    return this.kubectlService.executeCommand(command);
  }

  upgradeToVersion(deployment: string, namespace: string, version: string): Promise<KubectlResponse> {
    const image = `jia0/${deployment}:${version}`;
    const command = `kubectl set image deployment/${deployment} ${deployment}=${image} -n ${namespace}`;
    return this.executeRolloutCommand(command);
  }

  generateSetImageCommand(deployment: string, namespace: string, image: string): string {
    return `kubectl set image deployment/${deployment} ${deployment}=${image} -n ${namespace}`;
  }

  parseHistoryOutput(stdout: string): RolloutHistoryItem[] {
    const lines = stdout.split('\n').filter(line => line.trim());
    const items: RolloutHistoryItem[] = [];

    // Skip header line, process data lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        items.push({
          revision: parseInt(parts[0]) || 0,
          image: parts.length > 2 ? parts.slice(1, -1).join(' ') : 'Unknown',
          status: 'Active',
          created: parts[parts.length - 1] || 'Unknown'
        });
      }
    }

    return items.reverse(); // Show newest first
  }

}