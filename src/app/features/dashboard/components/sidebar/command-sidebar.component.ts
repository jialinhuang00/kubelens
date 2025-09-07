import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NamespaceSelectorComponent } from './namespace-selector.component';
import { ResourceSectionComponent } from './resource-section.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { SidebarData } from '../../../../shared/interfaces/sidebar-data.interface';
import { UiStateService } from '../../services/ui-state.service';

@Component({
  selector: 'app-command-sidebar',
  imports: [CommonModule, NamespaceSelectorComponent, ResourceSectionComponent],
  templateUrl: './command-sidebar.component.html',
  styleUrl: './command-sidebar.component.scss'
})
export class CommandSidebarComponent {
  @Input() data!: SidebarData;
  
  private uiStateService = inject(UiStateService);

  // Resource change events (still needed for business logic)
  @Output() namespaceChange = new EventEmitter<string>();
  @Output() deploymentChange = new EventEmitter<string>();
  @Output() podChange = new EventEmitter<string>();
  @Output() serviceChange = new EventEmitter<string>();
  @Output() templateExecute = new EventEmitter<CommandTemplate>();

  // UI state now handled internally via service
  get isGeneralExpanded() { return this.uiStateService.isGeneralExpandedState; }
  get isDeploymentExpanded() { return this.uiStateService.isDeploymentExpandedState; }
  get isPodSectionExpanded() { return this.uiStateService.isPodSectionExpandedState; }
  get isServiceSectionExpanded() { return this.uiStateService.isServiceSectionExpandedState; }

  onNamespaceChange(namespace: string) {
    this.namespaceChange.emit(namespace);
  }

  onDeploymentChange(deployment: string) {
    this.deploymentChange.emit(deployment);
  }

  onPodChange(pod: string) {
    this.podChange.emit(pod);
  }

  onServiceChange(service: string) {
    this.serviceChange.emit(service);
  }

  onTemplateExecute(template: CommandTemplate) {
    this.templateExecute.emit(template);
  }

  // UI events handled internally
  onToggleGeneralSection() {
    this.uiStateService.toggleGeneralSection();
  }

  onToggleDeploymentSection() {
    this.uiStateService.toggleDeploymentSection();
  }

  onTogglePodSection() {
    this.uiStateService.togglePodSection();
  }

  onToggleServiceSection() {
    this.uiStateService.toggleServiceSection();
  }
}