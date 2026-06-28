import { Injectable, inject } from '@angular/core';
import { CommandTemplate } from '../../../shared/models/kubectl.models';
import { ConfigService } from '../../../core/services/config.service';

@Injectable({
  providedIn: 'root'
})
export class TemplateService {
  private config = inject(ConfigService);

  /**
   * Build a kind's resource-panel command templates from config
   * (kubelens.default.yaml `templates`, keyed by Kind). `{name}` is substituted
   * with the selected resource; `{namespace}` is left for the downstream executor.
   * Replaces the per-kind generateXxxTemplates methods that were hardcoded here.
   */
  getTemplates(kind: string, name: string): CommandTemplate[] {
    if (!name) return [];
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const defs = this.config.templates()[kind];
    if (defs?.length) {
      return defs.map((t, i) => ({
        id: `${kind.toLowerCase()}-${slug}-${i}`,
        name: t.name,
        command: t.command.replace(/\{name\}/g, name),
        requiresInput: t.requiresInput,
        disabled: t.disabled,
      }));
    }
    // No curated templates (e.g. a discovered CRD) — fall back to Details + YAML,
    // which work for any kind. Resolve the kubectl target from config/discovery.
    const rt = this.resourceTypeFor(kind);
    return [
      { id: `${kind.toLowerCase()}-${slug}-details`, name: 'Details', command: `kubectl describe ${rt} ${name} -n {namespace}` },
      { id: `${kind.toLowerCase()}-${slug}-yaml`, name: 'YAML', command: `kubectl get ${rt} ${name} -n {namespace} -o yaml` },
    ];
  }

  /** kubectl target for a Kind (group-qualified for CRDs), from config then discovery. */
  private resourceTypeFor(kind: string): string {
    return this.config.resources().find(r => r.kind === kind)?.resourceType
      ?? this.config.discovered().find(d => d.kind === kind)?.resourceType
      ?? kind.toLowerCase();
  }

  generateRolloutTemplates(deploymentName: string): CommandTemplate[] {
    if (!deploymentName) return [];

    return [
      {
        id: `rollout-${deploymentName}-history`,
        name: 'History',
        command: `kubectl rollout history deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-status`,
        name: 'Status',
        command: `kubectl rollout status deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-undo`,
        name: 'Undo Last',
        command: `kubectl rollout undo deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-pause`,
        name: 'Pause',
        command: `kubectl rollout pause deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-resume`,
        name: 'Resume',
        command: `kubectl rollout resume deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-restart`,
        name: 'Restart',
        command: `kubectl rollout restart deployment/${deploymentName} -n {namespace}`,
      }
    ];
  }

  substituteTemplate(
    command: string,
    namespace: string,
    deployment?: string,
    pod?: string,
    service?: string
  ): string {
    return command
      .replace(/{namespace}/g, namespace)
      .replace(/{deployment}/g, deployment || '')
      .replace(/{pod}/g, pod || '')
      .replace(/{service}/g, service || '');
  }
}
