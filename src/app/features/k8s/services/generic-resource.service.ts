import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';

export type ResourceType =
  | 'cronjobs'
  | 'statefulsets'
  | 'jobs'
  | 'configmaps'
  | 'secrets'
  | 'persistentvolumeclaims'
  | 'serviceaccounts'
  | 'ingresses'
  | 'gateways'
  | 'httproutes';

export interface ResourceState {
  items: string[];
  selected: string;
  isLoading: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class GenericResourceService {
  private kubectlService = inject(KubectlService);

  // Signal map for each resource type
  private stateMap = new Map<ResourceType, {
    items: ReturnType<typeof signal<string[]>>;
    selected: ReturnType<typeof signal<string>>;
    isLoading: ReturnType<typeof signal<boolean>>;
  }>();

  private readonly resourceTypes: ResourceType[] = [
    'cronjobs', 'statefulsets', 'jobs', 'configmaps', 'secrets',
    'persistentvolumeclaims', 'serviceaccounts', 'ingresses', 'gateways', 'httproutes'
  ];

  constructor() {
    for (const type of this.resourceTypes) {
      this.stateMap.set(type, {
        items: signal<string[]>([]),
        selected: signal<string>(''),
        isLoading: signal<boolean>(false),
      });
    }
  }

  getItems(type: ResourceType) {
    return this.stateMap.get(type)!.items;
  }

  getSelected(type: ResourceType) {
    return this.stateMap.get(type)!.selected;
  }

  getIsLoading(type: ResourceType) {
    return this.stateMap.get(type)!.isLoading;
  }

  setSelected(type: ResourceType, value: string) {
    this.stateMap.get(type)!.selected.set(value);
  }

  async loadResource(type: ResourceType, namespace: string) {
    if (!namespace) return;

    const state = this.stateMap.get(type)!;
    state.isLoading.set(true);
    try {
      const items = await this.kubectlService.getResourceNames(type, namespace);
      state.items.set(items);
      if (state.selected() && !items.includes(state.selected())) {
        state.selected.set('');
      }
    } catch (error) {
      console.error(`Failed to load ${type}:`, error);
      state.items.set([]);
    } finally {
      state.isLoading.set(false);
    }
  }

  async loadAllResources(namespace: string) {
    await Promise.all(
      this.resourceTypes.map(type => this.loadResource(type, namespace))
    );
  }

  resetAllSelections() {
    for (const type of this.resourceTypes) {
      this.stateMap.get(type)!.selected.set('');
    }
  }

  resetAll() {
    for (const type of this.resourceTypes) {
      const state = this.stateMap.get(type)!;
      state.items.set([]);
      state.selected.set('');
      state.isLoading.set(false);
    }
  }

  getAllTypes(): ResourceType[] {
    return this.resourceTypes;
  }
}
