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
  // Workloads
  { kind: 'Deployment', label: 'Deployments', color: '#e8b866', resourceType: 'deployments' },
  { kind: 'StatefulSet', label: 'StatefulSets', color: '#e0a050', resourceType: 'statefulsets' },
  { kind: 'DaemonSet', label: 'DaemonSets', color: '#d4956a', resourceType: 'daemonsets' },
  { kind: 'CronJob', label: 'CronJobs', color: '#c8a060', resourceType: 'cronjobs' },
  { kind: 'Job', label: 'Jobs', color: '#b89860', resourceType: 'jobs' },
  { kind: 'Pod', label: 'Pods', color: '#f0d080', resourceType: 'pods' },
  { kind: 'ReplicaSet', label: 'ReplicaSets', color: '#c0b880', resourceType: 'replicasets' },
  // Networking
  { kind: 'Service', label: 'Services', color: '#80c0b0', resourceType: 'services' },
  { kind: 'Ingress', label: 'Ingresses', color: '#70b8a8', resourceType: 'ingresses' },
  { kind: 'NetworkPolicy', label: 'NetworkPolicies', color: '#90a8b8', resourceType: 'networkpolicies' },
  // Config
  { kind: 'ConfigMap', label: 'ConfigMaps', color: '#a0b880', resourceType: 'configmaps' },
  { kind: 'Secret', label: 'Secrets', color: '#c0a8a0', resourceType: 'secrets' },
  // Storage
  { kind: 'PersistentVolumeClaim', label: 'PVCs', color: '#90b0c8', resourceType: 'persistentvolumeclaims' },
  // Scaling
  { kind: 'HorizontalPodAutoscaler', label: 'HPAs', color: '#b8a080', resourceType: 'horizontalpodautoscalers' },
  // RBAC
  { kind: 'ServiceAccount', label: 'ServiceAccounts', color: '#a8a0c0', resourceType: 'serviceaccounts' },
  { kind: 'Role', label: 'Roles', color: '#b0a0c8', resourceType: 'roles' },
  { kind: 'RoleBinding', label: 'RoleBindings', color: '#a898b8', resourceType: 'rolebindings' },
];

// Priority batch: most-used resources — one kubectl call, shows up first
const PRIORITY_KINDS = new Set(['Deployment', 'Pod', 'Service']);
const PRIORITY_TYPES = ['deployments', 'pods', 'services'];

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

    const group = ExecutionGroupGenerator.namespaceResourceLoading(namespace);
    const rest = RESOURCE_KINDS.filter(cfg => !PRIORITY_KINDS.has(cfg.kind));

    // Phase 1: one kubectl call for the 8 common resource types
    const priorityNames = await this.executionContext.withGroup(group, () =>
      this.kubectlService.getResourceNamesBatch(PRIORITY_TYPES, namespace)
    );
    this.tree.update(nodes => nodes.map(n =>
      PRIORITY_KINDS.has(n.kind)
        ? { ...n, items: priorityNames[n.kind] || [], isLoading: false, count: (priorityNames[n.kind] || []).length }
        : n
    ));

    // Phase 2: remaining 9 types — individual calls in parallel, same group
    await this.executionContext.withGroup(group, () =>
      Promise.all(rest.map(async (cfg) => {
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

  async reloadKind(kind: string, namespace: string): Promise<void> {
    const cfg = RESOURCE_KINDS.find(c => c.kind.toLowerCase() === kind.toLowerCase());
    if (!cfg) return;

    this.tree.update(nodes => nodes.map(n =>
      n.kind === cfg.kind ? { ...n, isLoading: true } : n
    ));

    const items = await this.kubectlService.getResourceNames(cfg.resourceType, namespace);
    this.tree.update(nodes => nodes.map(n =>
      n.kind === cfg.kind ? { ...n, items, isLoading: false, count: items.length } : n
    ));
  }

  toggleKind(kind: string, _namespace: string): void {
    const node = this.tree().find(n => n.kind === kind);
    if (!node) return;
    this.tree.update(nodes => nodes.map(n =>
      n.kind === kind ? { ...n, isExpanded: !n.isExpanded } : n
    ));
  }

}
