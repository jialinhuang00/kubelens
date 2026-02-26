import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { ResourceTreeNode } from '../models/panel.models';

import { ResourceType } from '../../../shared/models/kubectl.models';

interface ResourceKindConfig {
  kind: string;
  label: string;
  color: string;
  resourceType: ResourceType;
}

const RESOURCE_KINDS: ResourceKindConfig[] = [
  { kind: 'Deployment', label: 'Deployments', color: '#e8b866', resourceType: 'deployments' },
  { kind: 'Pod', label: 'Pods', color: '#f0d080', resourceType: 'pods' },
  { kind: 'Service', label: 'Services', color: '#d4956a', resourceType: 'services' },
  { kind: 'StatefulSet', label: 'StatefulSets', color: '#e0a050', resourceType: 'statefulsets' },
  { kind: 'CronJob', label: 'CronJobs', color: '#c8a060', resourceType: 'cronjobs' },
  { kind: 'Job', label: 'Jobs', color: '#b89860', resourceType: 'jobs' },
  { kind: 'ConfigMap', label: 'ConfigMaps', color: '#a0b880', resourceType: 'configmaps' },
  { kind: 'Secret', label: 'Secrets', color: '#c0a8a0', resourceType: 'secrets' },
  { kind: 'PersistentVolumeClaim', label: 'PVCs', color: '#90b0c8', resourceType: 'persistentvolumeclaims' },
  { kind: 'ServiceAccount', label: 'ServiceAccounts', color: '#a8a0c0', resourceType: 'serviceaccounts' },
  { kind: 'Ingress', label: 'Ingresses', color: '#80c0b0', resourceType: 'ingresses' },
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

    // Load each resource type individually (works in both realtime and snapshot)
    const group = ExecutionGroupGenerator.namespaceResourceLoading(namespace);
    await this.executionContext.withGroup(group, () =>
      Promise.all(RESOURCE_KINDS.map(async (cfg) => {
        const items = await this.kubectlService.getResourceNames(cfg.resourceType, namespace);
        this.tree.update(nodes => nodes.map(n =>
          n.kind === cfg.kind
            ? { ...n, items, isLoading: false, count: items.length }
            : n
        ));
      }))
    );

    this.isLoading.set(false);
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
