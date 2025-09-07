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
      // return { "success": true, "stdout": "apiVersion: v1\nkind: Service\nmetadata:\n  annotations:\n    kubectl.kubernetes.io/last-applied-configuration: |\n      {\"apiVersion\":\"v1\",\"kind\":\"Service\",\"metadata\":{\"annotations\":{},\"labels\":{\"app\":\"number-service\"},\"name\":\"number-service\",\"namespace\":\"noah\"},\"spec\":{\"ports\":[{\"port\":80,\"protocol\":\"TCP\",\"targetPort\":3000}],\"selector\":{\"app\":\"number-service\"},\"type\":\"ClusterIP\"}}\n  creationTimestamp: \"2025-09-05T14:40:46Z\"\n  labels:\n    app: number-service\n  name: number-service\n  namespace: noah\n  resourceVersion: \"20129\"\n  uid: 600e2140-ea0e-4293-98a7-417bc1ab774c\nspec:\n  clusterIP: 10.96.15.216\n  clusterIPs:\n  - 10.96.15.216\n  internalTrafficPolicy: Cluster\n  ipFamilies:\n  - IPv4\n  ipFamilyPolicy: SingleStack\n  ports:\n  - port: 80\n    protocol: TCP\n    targetPort: 3000\n  selector:\n    app: number-service\n  sessionAffinity: None\n  type: ClusterIP\nstatus:\n  loadBalancer: {}\n" }
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

  async getServices(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get services -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );

      if (response.success) {
        return response.stdout.trim().split(' ').filter(s => s);
      }

      return [];
    } catch (error) {
      console.error(`Failed to load services for namespace ${namespace}:`, error);
      return [];
    }
  }
}