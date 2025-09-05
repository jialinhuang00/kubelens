import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from './template.service';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

@Injectable({
  providedIn: 'root'
})
export class ResourceService {
  private kubectlService = inject(KubectlService);
  private templateService = inject(TemplateService);

  // Resource data
  namespaces = signal<string[]>([]);
  deployments = signal<string[]>([]);
  pods = signal<string[]>([]);
  
  // Template data  
  generalTemplates = signal<CommandTemplate[]>([]);
  deploymentTemplates = signal<CommandTemplate[]>([]);
  podTemplates = signal<CommandTemplate[]>([]);
  
  // Loading states
  isInitializing = signal<boolean>(true);
  isLoadingNamespaces = signal<boolean>(false);

  async initialize() {
    this.isInitializing.set(true);
    try {
      await this.loadNamespaces();
      this.generalTemplates.set(this.templateService.getGeneralTemplates());
    } catch (error) {
      console.error('Failed to initialize:', error);
    } finally {
      this.isInitializing.set(false);
    }
  }

  async loadNamespaces() {
    this.isLoadingNamespaces.set(true);
    try {
      const namespaces = await this.kubectlService.getNamespaces();
      this.namespaces.set(namespaces);
    } catch (error) {
      console.error('Failed to load namespaces:', error);
      this.namespaces.set([]);
    } finally {
      this.isLoadingNamespaces.set(false);
    }
  }

  async loadResourcesForNamespace(namespace: string) {
    if (!namespace) return;
    
    try {
      // Load deployments (templates will be generated when a deployment is selected)
      const deployments = await this.kubectlService.getDeployments(namespace);
      this.deployments.set(deployments);
      this.deploymentTemplates.set([]); // Clear deployment templates, will be generated on selection
      
      // Load pods (templates will be generated when a pod is selected)
      const pods = await this.kubectlService.getPods(namespace);
      this.pods.set(pods);
      this.podTemplates.set([]); // Clear pod templates, will be generated on selection
      
    } catch (error) {
      console.error('Failed to load resources:', error);
      this.deployments.set([]);
      this.pods.set([]);
      this.deploymentTemplates.set([]);
      this.podTemplates.set([]);
    }
  }

  updateDeploymentTemplates(selectedDeployment: string) {
    const templates = this.templateService.generateDeploymentTemplates(selectedDeployment);
    this.deploymentTemplates.set(templates);
  }

  updatePodTemplates(selectedPod: string) {
    const templates = this.templateService.generatePodTemplates(selectedPod);
    this.podTemplates.set(templates);
  }

  executeTemplate(template: CommandTemplate, namespace: string): string {
    return this.templateService.replaceNamespacePlaceholder(template.command, namespace);
  }
}