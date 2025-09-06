import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NamespaceSelectorComponent } from './namespace-selector.component';
import { ResourceSectionComponent } from './resource-section.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';
import { SidebarData } from '../../../../shared/interfaces/sidebar-data.interface';

@Component({
  selector: 'app-command-sidebar',
  imports: [CommonModule, NamespaceSelectorComponent, ResourceSectionComponent],
  templateUrl: './command-sidebar.component.html',
  styleUrl: './command-sidebar.component.scss'
})
export class CommandSidebarComponent {
  @Input() data!: SidebarData;

  // Events
  @Output() namespaceChange = new EventEmitter<string>();
  @Output() deploymentChange = new EventEmitter<string>();
  @Output() podChange = new EventEmitter<string>();
  @Output() serviceChange = new EventEmitter<string>();
  @Output() templateExecute = new EventEmitter<CommandTemplate>();
  @Output() toggleGeneralSection = new EventEmitter<void>();
  @Output() toggleDeploymentSection = new EventEmitter<void>();
  @Output() togglePodSection = new EventEmitter<void>();
  @Output() toggleServiceSection = new EventEmitter<void>();

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

  onToggleGeneralSection() {
    this.toggleGeneralSection.emit();
  }

  onToggleDeploymentSection() {
    this.toggleDeploymentSection.emit();
  }

  onTogglePodSection() {
    this.togglePodSection.emit();
  }

  onToggleServiceSection() {
    this.toggleServiceSection.emit();
  }
}