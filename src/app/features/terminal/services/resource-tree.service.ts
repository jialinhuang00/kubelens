import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { ResourceTreeNode } from '../models/panel.models';

interface ResourceKindConfig {
  kind: string;
  label: string;
  color: string;
}

const RESOURCE_KINDS: ResourceKindConfig[] = [
  { kind: 'Deployment', label: 'Deployments', color: '#e8b866' },
  { kind: 'Pod', label: 'Pods', color: '#f0d080' },
  { kind: 'Service', label: 'Services', color: '#d4956a' },
  { kind: 'StatefulSet', label: 'StatefulSets', color: '#e0a050' },
  { kind: 'CronJob', label: 'CronJobs', color: '#c8a060' },
  { kind: 'Job', label: 'Jobs', color: '#b89860' },
  { kind: 'ConfigMap', label: 'ConfigMaps', color: '#a0b880' },
  { kind: 'Secret', label: 'Secrets', color: '#c0a8a0' },
  { kind: 'PersistentVolumeClaim', label: 'PVCs', color: '#90b0c8' },
  { kind: 'ServiceAccount', label: 'ServiceAccounts', color: '#a8a0c0' },
  { kind: 'Ingress', label: 'Ingresses', color: '#80c0b0' },
];

@Injectable({ providedIn: 'root' })
export class ResourceTreeService {
  private kubectlService = inject(KubectlService);
  private executionContext = inject(ExecutionContextService);

  tree = signal<ResourceTreeNode[]>([]);
  isLoading = signal(false);

  async loadForNamespace(namespace: string): Promise<void> {
    this.isLoading.set(true);

    // Show loading state on all nodes
    this.tree.set(RESOURCE_KINDS.map(cfg => ({
      kind: cfg.kind,
      label: cfg.label,
      color: cfg.color,
      items: [],
      isExpanded: false,
      isLoading: true,
      count: 0,
    })));

    // One kubectl call, one child process, all 11 resource types
    const group = ExecutionGroupGenerator.namespaceResourceLoading(namespace);
    const allResources = await this.executionContext.withGroup(group, () =>
      this.kubectlService.getAllResourceNames(namespace)
    );

    this.isLoading.set(false);

    // Update tree — items.length IS the count
    this.tree.set(RESOURCE_KINDS.map(cfg => {
      const items = allResources[cfg.kind] || [];
      return {
        kind: cfg.kind,
        label: cfg.label,
        color: cfg.color,
        items,
        isExpanded: false,
        isLoading: false,
        count: items.length,
      };
    }));
  }

  toggleKind(kind: string, _namespace: string): void {
    const node = this.tree().find(n => n.kind === kind);
    if (!node) return;
    this.tree.update(nodes => nodes.map(n =>
      n.kind === kind ? { ...n, isExpanded: !n.isExpanded } : n
    ));
  }

  getTemplateGeneratorKind(kind: string): string {
    const map: Record<string, string> = {
      'Deployment': 'deployment',
      'Pod': 'pod',
      'Service': 'service',
      'StatefulSet': 'statefulsets',
      'CronJob': 'cronjobs',
      'Job': 'jobs',
      'ConfigMap': 'configmaps',
      'Secret': 'secrets',
      'PersistentVolumeClaim': 'persistentvolumeclaims',
      'ServiceAccount': 'serviceaccounts',
      'Ingress': 'ingresses',
    };
    return map[kind] || kind.toLowerCase();
  }
}
