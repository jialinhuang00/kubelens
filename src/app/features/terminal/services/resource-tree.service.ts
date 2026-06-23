import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { ConfigService, kindId } from '../../../core/services/config.service';
import { VisibilityService } from '../../../core/services/visibility.service';
import { ExecutionContextService } from '../../../core/services/execution-context.service';
import { ExecutionGroupGenerator } from '../../../shared/constants/execution-groups.constants';
import { ResourceTreeNode } from '../models/panel.models';

interface TreeKind {
  kind: string;
  group: string;
  label: string;
  color: string;
  resourceType: string;
  priority: boolean;
}

const DISCOVERED_COLOR = '#8a8a8a';

@Injectable({ providedIn: 'root' })
export class ResourceTreeService {
  private kubectlService = inject(KubectlService);
  private config = inject(ConfigService);
  private visibility = inject(VisibilityService);
  private executionContext = inject(ExecutionContextService);

  tree = signal<ResourceTreeNode[]>([]);
  isLoading = signal(false);

  /** Tree filtered by per-user visibility — client-side filter of already-loaded data, no refetch. */
  visibleTree = computed(() =>
    this.tree().filter(n => this.visibility.isVisible(kindId(n.group, n.kind), 'tree'))
  );

  private loadGeneration = 0;
  private currentNamespace = '';
  private loadedIds = new Set<string>();

  constructor() {
    // When the user enables a discovered (non-config) kind that isn't loaded yet,
    // fetch it on demand and add it to the tree.
    effect(() => {
      this.visibility.overrides(); // dependency: re-run on any toggle
      const ns = this.currentNamespace;
      if (!ns) return;
      for (const d of this.config.discovered()) {
        const id = kindId(d.group, d.kind);
        if (this.loadedIds.has(id) || this.isConfigKind(id)) continue;
        if (this.visibility.isVisible(id, 'tree')) {
          this.fetchKind(
            { kind: d.kind, group: d.group, label: d.kind, color: DISCOVERED_COLOR, resourceType: d.resourceType, priority: false },
            ns,
          );
        }
      }
    });
  }

  private isConfigKind(id: string): boolean {
    return this.config.resources().some(r => kindId(r.group, r.kind) === id);
  }

  /** Kinds to load: all config tree-kinds (so re-show is instant) + enabled discovered kinds. */
  private treeKinds(): TreeKind[] {
    const fromConfig: TreeKind[] = this.config.treeKinds().map(c => ({
      kind: c.kind, group: c.group, label: c.label, color: c.color, resourceType: c.resourceType, priority: !!c.priority,
    }));
    const seen = new Set(fromConfig.map(k => kindId(k.group, k.kind)));
    const fromDiscovered: TreeKind[] = this.config.discovered()
      .filter(d => !seen.has(kindId(d.group, d.kind)) && this.visibility.isVisible(kindId(d.group, d.kind), 'tree'))
      .map(d => ({ kind: d.kind, group: d.group, label: d.kind, color: DISCOVERED_COLOR, resourceType: d.resourceType, priority: false }));
    return [...fromConfig, ...fromDiscovered];
  }

  private makeNode(k: TreeKind): ResourceTreeNode {
    return {
      kind: k.kind, group: k.group, resourceType: k.resourceType, label: k.label, color: k.color,
      items: [], isExpanded: false, isLoading: true, count: 0,
    };
  }

  async loadForNamespace(namespace: string): Promise<void> {
    this.currentNamespace = namespace;
    const myGen = ++this.loadGeneration;
    this.isLoading.set(true);
    this.loadedIds.clear();

    // Kind list is config-driven; namespace selection itself does not wait on it,
    // but building the tree does.
    await this.config.ensureLoaded();
    await this.config.ensureDiscovered();
    if (myGen !== this.loadGeneration) return;

    const kinds = this.treeKinds();
    for (const k of kinds) this.loadedIds.add(kindId(k.group, k.kind));
    const priorityKinds = new Set(kinds.filter(k => k.priority).map(k => k.kind));
    const priorityTypes = kinds.filter(k => k.priority).map(k => k.resourceType);

    this.tree.set(kinds.map(k => this.makeNode(k)));

    const group = ExecutionGroupGenerator.namespaceResourceLoading(namespace);
    const rest = kinds.filter(k => !priorityKinds.has(k.kind));

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
      Promise.all(rest.map(async (k) => {
        const items = await this.kubectlService.getResourceNames(k.resourceType, namespace);
        if (myGen !== this.loadGeneration) return;
        this.tree.update(nodes => nodes.map(n =>
          (n.kind === k.kind && n.group === k.group) ? { ...n, items, isLoading: false, count: items.length } : n
        ));
      }))
    );

    if (myGen !== this.loadGeneration) return;
    this.isLoading.set(false);
  }

  /** Fetch one kind on demand (a discovered kind the user just enabled) and add it to the tree. */
  private async fetchKind(k: TreeKind, namespace: string): Promise<void> {
    const id = kindId(k.group, k.kind);
    if (this.loadedIds.has(id)) return;
    this.loadedIds.add(id);
    this.tree.update(nodes => [...nodes, this.makeNode(k)]);
    const items = await this.kubectlService.getResourceNames(k.resourceType, namespace);
    if (namespace !== this.currentNamespace) return; // namespace changed mid-fetch
    this.tree.update(nodes => nodes.map(n =>
      (n.kind === k.kind && n.group === k.group) ? { ...n, items, isLoading: false, count: items.length } : n
    ));
  }

  async reloadKind(kind: string, namespace: string): Promise<void> {
    const node = this.tree().find(n => n.kind === kind);
    if (!node) return;
    this.tree.update(nodes => nodes.map(n => n.kind === kind ? { ...n, isLoading: true } : n));
    const items = await this.kubectlService.getResourceNames(node.resourceType, namespace);
    this.tree.update(nodes => nodes.map(n =>
      n.kind === kind ? { ...n, items, isLoading: false, count: items.length } : n
    ));
  }

  toggleKind(kind: string, _namespace: string): void {
    this.tree.update(nodes => nodes.map(n => n.kind === kind ? { ...n, isExpanded: !n.isExpanded } : n));
  }
}
