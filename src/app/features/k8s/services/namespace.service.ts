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
  error = signal<string | null>(null);

  async loadNamespaces() {
    this.isLoading.set(true);
    this.error.set(null);
    this.namespaces.set([]);
    try {
      const namespaces = await this.kubectlService.getNamespaces();
      this.namespaces.set(namespaces);
    } catch (error) {
      console.error('Failed to load namespaces:', error);
      this.namespaces.set([]);
      this.error.set(this.friendly(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Turn a raw kubectl/exec error into a short, actionable line for the sidebar. */
  private friendly(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/token|sso|credentials|Unable to connect|exec/i.test(raw)) {
      return 'Cluster unreachable — kubectl auth failed. Check your login (e.g. re-run SSO), or switch to Snapshot mode.';
    }
    return raw.split('\n')[0] || 'Failed to reach the cluster.';
  }

  setCurrentNamespace(namespace: string) {
    this.currentNamespace.set(namespace);
  }

}