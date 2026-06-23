import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { ConfigService } from '../../../core/services/config.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { ResourceTreeNode } from '../models/panel.models';
import { ResourceType } from '../../../shared/models/kubectl.models';

@Injectable({ providedIn: 'root' })
export class ResourceTreeService {
  private kubectlService = inject(KubectlService);
  private config = inject(ConfigService);
  private executionContext = inject(ExecutionContextService);

  tree = signal<ResourceTreeNode[]>([]);
  isLoading = signal(false);

  private loadGeneration = 0;

  async loadForNamespace(namespace: string): Promise<void> {
    const myGen = ++this.loadGeneration;
    this.isLoading.set(true);

    // Kind list is config-driven; namespace selection itself does not wait on it,
    // but building the tree does. Guards against the rare load-before-config race.
    await this.config.ensureLoaded();
    if (myGen !== this.loadGeneration) return;

    const kinds = this.config.treeKinds();
    const priorityKinds = new Set(kinds.filter(k => k.priority).map(k => k.kind));
    const priorityTypes = kinds.filter(k => k.priority).map(k => k.resourceType);

    // Show loading state on all nodes
    this.tree.set(kinds.map(cfg => ({
      kind: cfg.kind,
      label: cfg.label,
      color: cfg.color,
      items: [],
      isExpanded: false,
      isLoading: true,
      count: 0,
    })));

    const group = ExecutionGroupGenerator.namespaceResourceLoading(namespace);
    const rest = kinds.filter(cfg => !priorityKinds.has(cfg.kind));

    // Phase 1: one kubectl call for the priority resource types
    const priorityNames = await this.executionContext.withGroup(group, () =>
      this.kubectlService.getResourceNamesBatch(priorityTypes, namespace)
    );
    if (myGen !== this.loadGeneration) return;
    this.tree.update(nodes => nodes.map(n =>
      priorityKinds.has(n.kind)
        ? { ...n, items: priorityNames[n.kind] || [], isLoading: false, count: (priorityNames[n.kind] || []).length }
        : n
    ));

    // Phase 2: remaining types, individual calls in parallel, same group
    await this.executionContext.withGroup(group, () =>
      Promise.all(rest.map(async (cfg) => {
        const items = await this.kubectlService.getResourceNames(cfg.resourceType as ResourceType, namespace);
        if (myGen !== this.loadGeneration) return;
        this.tree.update(nodes => nodes.map(n =>
          n.kind === cfg.kind
            ? { ...n, items, isLoading: false, count: items.length }
            : n
        ));
      }))
    );

    if (myGen !== this.loadGeneration) return;
    this.isLoading.set(false);
  }

  async reloadKind(kind: string, namespace: string): Promise<void> {
    await this.config.ensureLoaded();
    const cfg = this.config.treeKinds().find(c => c.kind.toLowerCase() === kind.toLowerCase());
    if (!cfg) return;

    this.tree.update(nodes => nodes.map(n =>
      n.kind === cfg.kind ? { ...n, isLoading: true } : n
    ));

    const items = await this.kubectlService.getResourceNames(cfg.resourceType as ResourceType, namespace);
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
