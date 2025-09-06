import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';

@Injectable({
  providedIn: 'root'
})
export class NamespaceService {
  private kubectlService = inject(KubectlService);

  // State
  namespaces = signal<string[]>([]);
  currentNamespace = signal<string>('');
  isLoading = signal<boolean>(false);

  async loadNamespaces() {
    this.isLoading.set(true);
    try {
      const namespaces = await this.kubectlService.getNamespaces();
      this.namespaces.set(namespaces);
      
      // Auto-select first namespace if none selected
      if (namespaces.length > 0 && !this.currentNamespace()) {
        this.setCurrentNamespace(namespaces[0]);
      }
    } catch (error) {
      console.error('Failed to load namespaces:', error);
      this.namespaces.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  setCurrentNamespace(namespace: string) {
    this.currentNamespace.set(namespace);
  }

  async getCurrentContext(): Promise<string> {
    try {
      const response = await this.kubectlService.executeCommand('kubectl config current-context');
      return response.success ? response.stdout.trim() : 'unknown';
    } catch (error) {
      console.error('Failed to get current context:', error);
      return 'unknown';
    }
  }
}