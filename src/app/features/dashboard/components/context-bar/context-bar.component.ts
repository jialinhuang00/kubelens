import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ResourceDropdown {
  key: string;
  label: string;
  items: string[];
  selected: string;
  isLoading?: boolean;
}

@Component({
  selector: 'app-context-bar',
  imports: [CommonModule],
  templateUrl: './context-bar.component.html',
  styleUrl: './context-bar.component.scss'
})
export class ContextBarComponent {
  @Input() namespaces: string[] = [];
  @Input() selectedNamespace = '';
  @Input() isLoading = false;
  @Input() resources: ResourceDropdown[] = [];
  @Input() resourceCounts: Record<string, number> = {};
  @Input() disabled = false;

  @Output() namespaceChange = new EventEmitter<string>();
  @Output() resourceChange = new EventEmitter<{ key: string; value: string }>();
  @Output() resourceExpand = new EventEmitter<string>();

  // Namespace filter
  filterText = signal('');

  // Collapsible section state
  isCollapsed = signal(false);

  // Which resource panel is expanded (null = all collapsed)
  expandedResource = signal<string | null>(null);

  filteredNamespaces = computed(() => {
    const filter = this.filterText().toLowerCase();
    if (!filter) return this.namespaces;
    return this.namespaces.filter(ns => ns.toLowerCase().includes(filter));
  });

  activeResourceCount = computed(() => {
    return this.resources.filter(r => r.items.length > 0 || (this.resourceCounts[r.key] || 0) > 0).length;
  });

  toggleCollapse() {
    this.isCollapsed.update(v => !v);
  }

  toggleResource(key: string) {
    const opening = this.expandedResource() !== key;
    this.expandedResource.update(cur => cur === key ? null : key);
    if (opening) {
      this.resourceExpand.emit(key);
    }
  }

  onFilterInput(event: Event) {
    this.filterText.set((event.target as HTMLInputElement).value);
  }

  onNamespaceSelect(ns: string) {
    this.namespaceChange.emit(ns);
    this.filterText.set('');
  }

  onResourceItemSelect(key: string, value: string) {
    this.resourceChange.emit({ key, value });
  }

  onResourceDeselect(key: string) {
    this.resourceChange.emit({ key, value: '' });
  }

  getSpineCount(res: ResourceDropdown): number {
    // If items are loaded, use actual count; otherwise use pre-fetched count
    if (res.items.length > 0) return res.items.length;
    return this.resourceCounts[res.key] || 0;
  }
}
