import { Injectable, inject, signal } from '@angular/core';
import { KubectlService } from '../../../core/services/kubectl.service';
import { TemplateService } from '../../dashboard/services/template.service';
import { CommandTemplate } from '../../../shared/models/kubectl.models';
import { ExecutionContextService } from '../../../core/services/execution-context.service';

export interface ServiceStatus {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  clusterIP: string;
  externalIPs: string[];
  ports: ServicePort[];
  selector: Record<string, string>;
  endpoints: Endpoint[];
}

export interface ServicePort {
  name: string;
  port: number;
  targetPort: string | number;
  protocol: 'TCP' | 'UDP';
  nodePort?: number;
}

export interface Endpoint {
  ip: string;
  ports: EndpointPort[];
  ready: boolean;
}

export interface EndpointPort {
  name: string;
  port: number;
  protocol: 'TCP' | 'UDP';
}

@Injectable({
  providedIn: 'root'
})
export class SvcService {
  private kubectlService = inject(KubectlService);
  private templateService = inject(TemplateService);
  private executionContext = inject(ExecutionContextService);

  // State
  services = signal<string[]>([]);
  selectedService = signal<string>('');
  serviceStatus = signal<ServiceStatus | null>(null);
  templates = signal<CommandTemplate[]>([]);
  isLoading = signal<boolean>(false);

  async loadServices(namespace: string) {
    if (!namespace) return;
    
    this.isLoading.set(true);
    try {
      const services = await this.kubectlService.getServices(namespace);
      this.services.set(services);
      
      // Clear selection if current service is not in new list
      if (this.selectedService() && !services.includes(this.selectedService())) {
        this.setSelectedService('');
      }
    } catch (error) {
      console.error('Failed to load services:', error);
      this.services.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  setSelectedService(service: string) {
    this.selectedService.set(service);
    
    if (service) {
      // Update templates
      const templates = this.templateService.generateServiceTemplates(service);
      this.templates.set(templates);
    } else {
      this.templates.set([]);
      this.serviceStatus.set(null);
    }
  }

  async getServiceStatus(service: string, namespace: string): Promise<ServiceStatus | null> {
    try {
      const serviceStatusGroup = `service-status-${service}-${namespace}-${Date.now()}`;
      const [serviceResponse, endpointsResponse] = await this.executionContext.withGroup(serviceStatusGroup, async () => {
        return Promise.all([
          this.kubectlService.executeCommand(
            `kubectl get service ${service} -n ${namespace} -o json`
          ),
          this.kubectlService.executeCommand(
            `kubectl get endpoints ${service} -n ${namespace} -o json`
          ).catch(() => ({ success: false, stdout: '{}', stderr: '' }))
        ]);
      });
      
      if (serviceResponse.success) {
        const serviceData = JSON.parse(serviceResponse.stdout);
        const endpointsData = endpointsResponse.success ? 
          JSON.parse(endpointsResponse.stdout) : null;
        
        const status: ServiceStatus = {
          name: serviceData.metadata.name,
          namespace: serviceData.metadata.namespace,
          type: serviceData.spec.type,
          clusterIP: serviceData.spec.clusterIP,
          externalIPs: serviceData.spec.externalIPs || [],
          ports: this.parseServicePorts(serviceData.spec.ports || []),
          selector: serviceData.spec.selector || {},
          endpoints: this.parseEndpoints(endpointsData?.subsets || [])
        };
        
        this.serviceStatus.set(status);
        return status;
      }
    } catch (error) {
      console.error('Failed to get service status:', error);
    }
    
    return null;
  }

  private parseServicePorts(ports: any[]): ServicePort[] {
    return ports.map(port => ({
      name: port.name || '',
      port: port.port,
      targetPort: port.targetPort,
      protocol: port.protocol || 'TCP',
      nodePort: port.nodePort
    }));
  }

  private parseEndpoints(subsets: any[]): Endpoint[] {
    const endpoints: Endpoint[] = [];
    
    for (const subset of subsets) {
      // Ready endpoints
      if (subset.addresses) {
        for (const address of subset.addresses) {
          endpoints.push({
            ip: address.ip,
            ports: this.parseEndpointPorts(subset.ports || []),
            ready: true
          });
        }
      }
      
      // Not ready endpoints
      if (subset.notReadyAddresses) {
        for (const address of subset.notReadyAddresses) {
          endpoints.push({
            ip: address.ip,
            ports: this.parseEndpointPorts(subset.ports || []),
            ready: false
          });
        }
      }
    }
    
    return endpoints;
  }

  private parseEndpointPorts(ports: any[]): EndpointPort[] {
    return ports.map(port => ({
      name: port.name || '',
      port: port.port,
      protocol: port.protocol || 'TCP'
    }));
  }

  async portForward(service: string, namespace: string, localPort: number, servicePort: number): Promise<boolean> {
    try {
      // Port forward to service
      const response = await this.kubectlService.executeCommand(
        `kubectl port-forward service/${service} -n ${namespace} ${localPort}:${servicePort}`
      );
      return response.success;
    } catch (error) {
      console.error('Failed to port forward to service:', error);
      return false;
    }
  }

  async getServiceEvents(service: string, namespace: string): Promise<any[]> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl get events -n ${namespace} --field-selector involvedObject.name=${service} --sort-by=.metadata.creationTimestamp -o json`
      );
      
      if (response.success) {
        const data = JSON.parse(response.stdout);
        return data.items || [];
      }
    } catch (error) {
      console.error('Failed to get service events:', error);
    }
    
    return [];
  }

  async testServiceConnection(service: string, namespace: string, port: number): Promise<{ success: boolean; message: string }> {
    try {
      // Try to create a temporary pod to test connection
      const testPod = `service-test-${Date.now()}`;
      const createResponse = await this.kubectlService.executeCommand(
        `kubectl run ${testPod} -n ${namespace} --image=busybox --rm -i --restart=Never -- nc -z ${service} ${port}`
      );
      
      return {
        success: createResponse.success,
        message: createResponse.success ? 
          `Connection to ${service}:${port} successful` :
          `Connection failed: ${createResponse.stderr}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Test failed: ${error}`
      };
    }
  }

  async deleteService(service: string, namespace: string): Promise<boolean> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl delete service ${service} -n ${namespace}`
      );
      return response.success;
    } catch (error) {
      console.error('Failed to delete service:', error);
      return false;
    }
  }

  async getServiceYaml(service: string, namespace: string): Promise<string | null> {
    try {
      const response = await this.kubectlService.executeCommand(
        `kubectl get service ${service} -n ${namespace} -o yaml`
      );
      return response.success ? response.stdout : null;
    } catch (error) {
      console.error('Failed to get service YAML:', error);
      return null;
    }
  }
}