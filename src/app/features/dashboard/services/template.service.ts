import { Injectable, signal } from '@angular/core';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

@Injectable({
  providedIn: 'root'
})
export class TemplateService {

  getGeneralTemplates(): CommandTemplate[] {
    return [
      {
        id: 'config-5',
        name: 'All Resources All Namespaces',
        command: 'kubectl get all --all-namespaces',
      },
      {
        id: 'config-4',
        name: 'All Namespaces Pods',
        command: 'kubectl get pods --all-namespaces',
      },
      {
        id: 'view-1',
        name: 'Pod Details + SHA',
        command: 'kubectl get pods -n {namespace} -o "custom-columns=POD_NAME:.metadata.name,DEPLOYMENT:.metadata.ownerReferences[0].name,CONTAINER_NAME:.spec.containers[*].name,IMAGE_SHA:.status.containerStatuses[*].imageID"',
      },
      {
        id: 'view-3',
        name: 'ReplicaSets Details',
        command: 'kubectl get replicasets -n {namespace} -o "custom-columns=REPLICASET:.metadata.name,DEPLOYMENT:.metadata.ownerReferences[0].name,DESIRED:.spec.replicas,CURRENT:.status.replicas,READY:.status.readyReplicas"',
      },
      {
        id: 'view-6',
        name: 'Events Timeline',
        command: 'kubectl get events -n {namespace} --sort-by=.metadata.creationTimestamp',
      },
      // {
      //   id: 'config-1',
      //   name: 'Current Context',
      //   command: 'kubectl config current-context',
      // },
      // {
      //   id: 'config-2',
      //   name: 'All Contexts',
      //   command: 'kubectl config get-contexts',
      // },
      {
        id: 'config-3',
        name: 'Node Status',
        command: 'kubectl get nodes -o wide',
      },


    ];
  }

  generateDeploymentTemplates(selectedDeployment: string): CommandTemplate[] {
    const stickyTemplates = [
      {
        id: 'deployment overall',
        name: 'Deployments',
        command: 'kubectl get deployments -n {namespace}',
        top: true
      },
    ];

    if (!selectedDeployment) return stickyTemplates;

    return [
      ...stickyTemplates,
      {
        id: `deploy-${selectedDeployment}-status`,
        name: `Rollout Status`,
        command: `kubectl rollout status deployment/${selectedDeployment} -n {namespace}`,
      },
      {
        id: `deploy-${selectedDeployment}-history`,
        name: `History`,
        command: `kubectl rollout history deployment/${selectedDeployment} -n {namespace}`,
      },
      {
        id: `deploy-${selectedDeployment}-describe`,
        name: `Details`,
        command: `kubectl describe deployment ${selectedDeployment} -n {namespace}`
      },
      // {
      //   id: `deploy-${selectedDeployment}-rollback`,
      //   name: `Rollback`,
      //   command: `kubectl rollout undo deployment/${selectedDeployment} -n {namespace}`
      // }
    ];
  }

  generatePodTemplates(selectedPod: string): CommandTemplate[] {
    const stickyTemplates = [
      {
        id: 'pods image',
        name: 'Pod Images',
        command: 'kubectl get pods -n {namespace} -o custom-columns="POD_NAME:.metadata.name,IMAGE:.spec.containers[*].image" --no-headers',
        top: true
      },
    ];

    if (!selectedPod) return stickyTemplates;

    return [
      ...stickyTemplates,
      {
        id: `pod-${selectedPod}-logs`,
        name: `Logs`,
        command: `kubectl logs ${selectedPod} -n {namespace} --tail=50`
      },
      {
        id: `pod-${selectedPod}-describe`,
        name: `Details`,
        command: `kubectl describe pod ${selectedPod} -n {namespace}`
      },
      {
        id: `pod-${selectedPod}-exec`,
        name: `Exec Shell`,
        command: `kubectl exec -it ${selectedPod} -n {namespace} -- /bin/sh`
      }
    ];
  }

  generateServiceTemplates(selectedService: string): CommandTemplate[] {
    const stickyTemplates = [
      {
        id: 'service overall',
        name: 'Services',
        command: 'kubectl get services -n {namespace}',
        top: true
      },
    ];

    if (!selectedService) return stickyTemplates;

    return [
      ...stickyTemplates,
      {
        id: `service-${selectedService}-describe`,
        name: `Details`,
        command: `kubectl describe service ${selectedService} -n {namespace}`
      },
      {
        id: `service-${selectedService}-endpoints`,
        name: `Endpoints`,
        command: `kubectl get endpoints ${selectedService} -n {namespace} -o wide`
      },
      {
        id: `service-${selectedService}-port-forward`,
        name: `Port Forward`,
        command: `kubectl port-forward service/${selectedService} 8080:80 -n {namespace}`
      },
      {
        id: `service-${selectedService}-yaml`,
        name: `YAML`,
        command: `kubectl get service ${selectedService} -n {namespace} -o yaml`
      },
      {
        id: `service-${selectedService}-type-nodeport`,
        name: `Change to NodePort`,
        command: `kubectl patch service ${selectedService} -n {namespace} -p '{"spec":{"type":"NodePort"}}'`
      },
      {
        id: `service-${selectedService}-type-clusterip`,
        name: `Change to ClusterIP`,
        command: `kubectl patch service ${selectedService} -n {namespace} -p '{"spec":{"type":"ClusterIP"}}'`
      }
    ];
  }

  generateRolloutTemplates(deploymentName: string): CommandTemplate[] {
    if (!deploymentName) return [];

    return [
      {
        id: `rollout-${deploymentName}-history`,
        name: 'History',
        command: `kubectl rollout history deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-status`,
        name: 'Status',
        command: `kubectl rollout status deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-undo`,
        name: 'Undo Last',
        command: `kubectl rollout undo deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-pause`,
        name: 'Pause',
        command: `kubectl rollout pause deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-resume`,
        name: 'Resume',
        command: `kubectl rollout resume deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-restart`,
        name: 'Restart',
        command: `kubectl rollout restart deployment/${deploymentName} -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-set-image-v2`,
        name: 'Set Image (v2)',
        command: `kubectl set image deployment/${deploymentName} ${deploymentName}=jia0/${deploymentName}:v2 -n {namespace}`,
      },
      {
        id: `rollout-${deploymentName}-set-image-v3`,
        name: 'Set Image (v3)',
        command: `kubectl set image deployment/${deploymentName} ${deploymentName}=jia0/${deploymentName}:v3 -n {namespace}`,
      }
    ];
  }

  replaceNamespacePlaceholder(command: string, namespace: string): string {
    return command.replace(/{namespace}/g, namespace);
  }

  substituteTemplate(
    command: string,
    namespace: string,
    deployment?: string,
    pod?: string,
    service?: string
  ): string {
    return command
      .replace(/{namespace}/g, namespace)
      .replace(/{deployment}/g, deployment || '')
      .replace(/{pod}/g, pod || '')
      .replace(/{service}/g, service || '');
  }
}