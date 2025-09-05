import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { KubectlResponse } from '../../shared/models/kubectl.models';


@Injectable({
  providedIn: 'root'
})
export class KubectlService {
  private http = inject(HttpClient);
  private readonly API_BASE = 'http://localhost:3000/api';

  async executeCommand(command: string): Promise<KubectlResponse> {
    try {
      const response = await this.http.post<KubectlResponse>(`${this.API_BASE}/execute`, {
        command: command
      }).toPromise();
      
      return response!;
    } catch (error) {
      return {
        success: false,
        stdout: '',
        error: `Network error: ${error}`
      };
    }
  }

  async getNamespaces(): Promise<string[]> {
    try {
      const response = await this.executeCommand('kubectl get namespaces -o jsonpath="{.items[*].metadata.name}"');
      
      if (response.success) {
        return response.stdout.trim().split(' ').filter(ns => ns);
      }
      
      // Fallback namespaces if command fails
      return [];
    } catch (error) {
      console.error('Failed to load namespaces:', error);
      return [];
    }
  }

  async getDeployments(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get deployments -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );
      
      if (response.success) {
        return response.stdout.trim().split(' ').filter(d => d);
      }
      
      return [];
    } catch (error) {
      console.error(`Failed to load deployments for namespace ${namespace}:`, error);
      return [];
    }
  }

  async getPods(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get pods -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );
      
      if (response.success) {
        return response.stdout.trim().split(' ').filter(p => p);
      }
      
      return [];
    } catch (error) {
      console.error(`Failed to load pods for namespace ${namespace}:`, error);
      return [];
    }
  }
}