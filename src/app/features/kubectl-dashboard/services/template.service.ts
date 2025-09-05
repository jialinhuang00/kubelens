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
        id: 'view-1',
        name: 'Pod Details + SHA',
        command: 'kubectl get pods -n {namespace} -o "custom-columns=POD_NAME:.metadata.name,DEPLOYMENT:.metadata.ownerReferences[0].name,CONTAINER_NAME:.spec.containers[*].name,IMAGE_SHA:.status.containerStatuses[*].imageID"',
      },
      {
        id: 'view-2',
        name: 'Pod Images',
        command: 'kubectl get pods -n {namespace} -o custom-columns="POD_NAME:.metadata.name,IMAGE:.spec.containers[*].image" --no-headers',
      },
      {
        id: 'view-3',
        name: 'ReplicaSets Details',
        command: 'kubectl get replicasets -n {namespace} -o "custom-columns=REPLICASET:.metadata.name,DEPLOYMENT:.metadata.ownerReferences[0].name,DESIRED:.spec.replicas,CURRENT:.status.replicas,READY:.status.readyReplicas"',
      },
      {
        id: 'view-4',
        name: 'Deployments',
        command: 'kubectl get deployments -n {namespace}',
      },
      {
        id: 'view-5',
        name: 'Services',
        command: 'kubectl get services -n {namespace}',
      },
      {
        id: 'view-6',
        name: 'Events Timeline',
        command: 'kubectl get events -n {namespace} --sort-by=.metadata.creationTimestamp',
      },
      {
        id: 'config-1',
        name: 'Current Context',
        command: 'kubectl config current-context',
      },
      {
        id: 'config-2',
        name: 'All Contexts',
        command: 'kubectl config get-contexts',
      },
      {
        id: 'config-3',
        name: 'Node Status',
        command: 'kubectl get nodes -o wide',
      },
      {
        id: 'config-4',
        name: 'All Namespaces Pods',
        command: 'kubectl get pods --all-namespaces',
      },

    ];
  }

  generateDeploymentTemplates(selectedDeployment: string): CommandTemplate[] {
    if (!selectedDeployment) return [];

    return [
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
    if (!selectedPod) return [];

    return [
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

  replaceNamespacePlaceholder(command: string, namespace: string): string {
    return command.replace(/{namespace}/g, namespace);
  }
}