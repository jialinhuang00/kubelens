import { Injectable, signal } from '@angular/core';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

@Injectable({
  providedIn: 'root'
})
export class TemplateService {

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
    ];
  }

  generatePodTemplates(selectedPod: string): CommandTemplate[] {
    if (!selectedPod) return [];

    return [
      {
        id: `pod-${selectedPod}-logs`,
        name: `Logs`,
        command: `kubectl logs ${selectedPod} -n {namespace} --tail=50 -f`
      },
      {
        id: `pod-${selectedPod}-logs-prev`,
        name: `Previous Logs`,
        command: `kubectl logs ${selectedPod} -n {namespace} --previous --tail=100`
      },
      {
        id: `pod-${selectedPod}-describe`,
        name: `Details`,
        command: `kubectl describe pod ${selectedPod} -n {namespace}`
      },
      {
        id: `pod-${selectedPod}-yaml`,
        name: `YAML`,
        command: `kubectl get pod ${selectedPod} -n {namespace} -o yaml`
      },
      {
        id: `pod-${selectedPod}-exec`,
        name: `Exec Shell`,
        command: `kubectl exec -it ${selectedPod} -n {namespace} -- /bin/sh`,
        disabled: true
      },
      {
        id: `pod-${selectedPod}-delete`,
        name: `Delete`,
        command: `kubectl delete pod ${selectedPod} -n {namespace}`
      },
    ];
  }

  generateServiceTemplates(selectedService: string): CommandTemplate[] {
    if (!selectedService) return [];

    return [
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
      }
    ];
  }

  generateCronJobTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `cj-${selected}-describe`, name: 'Details', command: `kubectl describe cronjob ${selected} -n {namespace}` },
      { id: `cj-${selected}-yaml`, name: 'YAML', command: `kubectl get cronjob ${selected} -n {namespace} -o yaml` },
      { id: `cj-${selected}-suspend`, name: 'Suspend', command: `kubectl patch cronjob ${selected} -n {namespace} -p '{"spec":{"suspend":true}}'` },
      { id: `cj-${selected}-resume`, name: 'Resume', command: `kubectl patch cronjob ${selected} -n {namespace} -p '{"spec":{"suspend":false}}'` },
      { id: `cj-${selected}-trigger`, name: 'Trigger Now', command: `kubectl create job ${selected}-manual --from=cronjob/${selected} -n {namespace}` },
    ];
  }

  generateStatefulSetTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `sts-${selected}-describe`, name: 'Details', command: `kubectl describe statefulset ${selected} -n {namespace}` },
      { id: `sts-${selected}-yaml`, name: 'YAML', command: `kubectl get statefulset ${selected} -n {namespace} -o yaml` },
      { id: `sts-${selected}-rollout`, name: 'Rollout Status', command: `kubectl rollout status statefulset/${selected} -n {namespace}` },
      { id: `sts-${selected}-restart`, name: 'Restart', command: `kubectl rollout restart statefulset/${selected} -n {namespace}` },
      { id: `sts-${selected}-scale`, name: 'Scale', command: `kubectl scale statefulset ${selected} --replicas= -n {namespace}`, requiresInput: true },
    ];
  }

  generateJobTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `job-${selected}-describe`, name: 'Details', command: `kubectl describe job ${selected} -n {namespace}` },
      { id: `job-${selected}-logs`, name: 'Logs', command: `kubectl logs job/${selected} -n {namespace} --tail=50` },
      { id: `job-${selected}-yaml`, name: 'YAML', command: `kubectl get job ${selected} -n {namespace} -o yaml` },
      { id: `job-${selected}-delete`, name: 'Delete', command: `kubectl delete job ${selected} -n {namespace}` },
    ];
  }

  generateConfigMapTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `cm-${selected}-describe`, name: 'Details', command: `kubectl describe configmap ${selected} -n {namespace}` },
      { id: `cm-${selected}-yaml`, name: 'YAML', command: `kubectl get configmap ${selected} -n {namespace} -o yaml` },
      { id: `cm-${selected}-json`, name: 'Data (JSON)', command: `kubectl get configmap ${selected} -n {namespace} -o jsonpath="{.data}"` },
    ];
  }

  generateSecretTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `secret-${selected}-describe`, name: 'Details', command: `kubectl describe secret ${selected} -n {namespace}` },
      { id: `secret-${selected}-yaml`, name: 'YAML', command: `kubectl get secret ${selected} -n {namespace} -o yaml` },
      { id: `secret-${selected}-decode`, name: 'Decode', command: `kubectl get secret ${selected} -n {namespace} -o jsonpath="{.data}" | jq 'to_entries[] | {key: .key, value: (.value | @base64d)}'` },
    ];
  }

  generatePVCTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `pvc-${selected}-describe`, name: 'Details', command: `kubectl describe pvc ${selected} -n {namespace}` },
      { id: `pvc-${selected}-yaml`, name: 'YAML', command: `kubectl get pvc ${selected} -n {namespace} -o yaml` },
    ];
  }

  generateServiceAccountTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `sa-${selected}-describe`, name: 'Details', command: `kubectl describe serviceaccount ${selected} -n {namespace}` },
      { id: `sa-${selected}-yaml`, name: 'YAML', command: `kubectl get serviceaccount ${selected} -n {namespace} -o yaml` },
    ];
  }

  generateIngressTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `ing-${selected}-describe`, name: 'Details', command: `kubectl describe ingress ${selected} -n {namespace}` },
      { id: `ing-${selected}-yaml`, name: 'YAML', command: `kubectl get ingress ${selected} -n {namespace} -o yaml` },
      { id: `ing-${selected}-endpoints`, name: 'Endpoints', command: `kubectl get endpoints -n {namespace}` },
    ];
  }

  generateDaemonSetTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `ds-${selected}-describe`, name: 'Details', command: `kubectl describe daemonset ${selected} -n {namespace}` },
      { id: `ds-${selected}-yaml`, name: 'YAML', command: `kubectl get daemonset ${selected} -n {namespace} -o yaml` },
      { id: `ds-${selected}-rollout`, name: 'Rollout Status', command: `kubectl rollout status daemonset/${selected} -n {namespace}` },
      { id: `ds-${selected}-restart`, name: 'Restart', command: `kubectl rollout restart daemonset/${selected} -n {namespace}` },
    ];
  }

  generateReplicaSetTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `rs-${selected}-describe`, name: 'Details', command: `kubectl describe replicaset ${selected} -n {namespace}` },
      { id: `rs-${selected}-yaml`, name: 'YAML', command: `kubectl get replicaset ${selected} -n {namespace} -o yaml` },
      { id: `rs-${selected}-scale`, name: 'Scale', command: `kubectl scale replicaset ${selected} --replicas= -n {namespace}`, requiresInput: true },
    ];
  }

  generateHPATemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `hpa-${selected}-describe`, name: 'Details', command: `kubectl describe hpa ${selected} -n {namespace}` },
      { id: `hpa-${selected}-yaml`, name: 'YAML', command: `kubectl get hpa ${selected} -n {namespace} -o yaml` },
      { id: `hpa-${selected}-status`, name: 'Status', command: `kubectl get hpa ${selected} -n {namespace} -o wide` },
    ];
  }

  generateNetworkPolicyTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `np-${selected}-describe`, name: 'Details', command: `kubectl describe networkpolicy ${selected} -n {namespace}` },
      { id: `np-${selected}-yaml`, name: 'YAML', command: `kubectl get networkpolicy ${selected} -n {namespace} -o yaml` },
    ];
  }

  generateRoleTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `role-${selected}-describe`, name: 'Details', command: `kubectl describe role ${selected} -n {namespace}` },
      { id: `role-${selected}-yaml`, name: 'YAML', command: `kubectl get role ${selected} -n {namespace} -o yaml` },
    ];
  }

  generateRoleBindingTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `rb-${selected}-describe`, name: 'Details', command: `kubectl describe rolebinding ${selected} -n {namespace}` },
      { id: `rb-${selected}-yaml`, name: 'YAML', command: `kubectl get rolebinding ${selected} -n {namespace} -o yaml` },
    ];
  }

  generateApplicationTemplates(selected: string): CommandTemplate[] {
    if (!selected) return [];
    return [
      { id: `app-${selected}-summary`, name: 'Summary', command: `kubectl get applications.argoproj.io ${selected} -n {namespace} -o custom-columns="SYNC:.status.sync.status,HEALTH:.status.health.status,REPO:.spec.source.repoURL,PATH:.spec.source.path,REVISION:.spec.source.targetRevision,DEST_NS:.spec.destination.namespace"` },
      { id: `app-${selected}-resources`, name: 'Resources', command: `kubectl get applications.argoproj.io ${selected} -n {namespace} -o jsonpath="{range .status.resources[*]}{.kind}/{.name} {.status} {.health.status}{'\\n'}{end}"` },
      { id: `app-${selected}-describe`, name: 'Details', command: `kubectl describe applications.argoproj.io ${selected} -n {namespace}` },
      { id: `app-${selected}-yaml`, name: 'YAML', command: `kubectl get applications.argoproj.io ${selected} -n {namespace} -o yaml` },
    ];
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