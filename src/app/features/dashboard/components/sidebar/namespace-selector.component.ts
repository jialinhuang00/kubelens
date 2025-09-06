import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-namespace-selector',
  imports: [CommonModule],
  templateUrl: './namespace-selector.component.html',
  styleUrl: './namespace-selector.component.scss'
})
export class NamespaceSelectorComponent {
  @Input() namespaces: string[] = [];
  @Input() selectedNamespace: string = '';
  @Input() isInitializing: boolean = false;
  @Input() isLoadingNamespaces: boolean = false;

  @Output() namespaceChange = new EventEmitter<string>();

  onNamespaceChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.namespaceChange.emit(target.value);
  }
}