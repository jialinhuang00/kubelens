import { SourceField } from '../../../../shared/graph-types';

export interface FieldBase {
  short: string;
  yaml: string;
}

export const FIELD_BASE: Record<SourceField, FieldBase> = {
  [SourceField.ServiceAccountName]: { short: 'Runs as ServiceAccount',                          yaml: 'spec.template.spec.serviceAccountName' },
  [SourceField.EnvFromConfigMap]:   { short: 'Loads all keys from ConfigMap (env)',              yaml: 'containers[].envFrom[].configMapRef' },
  [SourceField.EnvFromSecret]:      { short: 'Loads all keys from Secret (env)',                 yaml: 'containers[].envFrom[].secretRef' },
  [SourceField.EnvConfigMapKey]:    { short: 'Reads one key from ConfigMap',                     yaml: 'containers[].env[].valueFrom.configMapKeyRef' },
  [SourceField.EnvSecretKey]:       { short: 'Reads one key from Secret',                        yaml: 'containers[].env[].valueFrom.secretKeyRef' },
  [SourceField.VolumePVC]:          { short: 'Mounts PVC as volume',                             yaml: 'volumes[].persistentVolumeClaim.claimName' },
  [SourceField.VolumeConfigMap]:    { short: 'Mounts ConfigMap as volume',                       yaml: 'volumes[].configMap.name' },
  [SourceField.VolumeSecret]:       { short: 'Mounts Secret as volume',                          yaml: 'volumes[].secret.secretName' },
  [SourceField.ProjectedConfigMap]: { short: 'Projected ConfigMap volume',                       yaml: 'volumes[].projected.sources[].configMap' },
  [SourceField.ProjectedSecret]:    { short: 'Projected Secret volume',                          yaml: 'volumes[].projected.sources[].secret' },
  [SourceField.Selector]:           { short: 'Service selects Pods by label',                    yaml: 'spec.selector' },
  [SourceField.ParentRefs]:         { short: 'Route attaches to Gateway',                        yaml: 'spec.parentRefs[].name' },
  [SourceField.BackendRefs]:        { short: 'Route forwards traffic to Service',                yaml: 'spec.rules[].backendRefs[].name' },
  [SourceField.IngressBackend]:     { short: 'Ingress forwards to Service backend',              yaml: 'spec.rules[].http.paths[].backend.service.name' },
  [SourceField.ScaleTargetRef]:     { short: 'HPA scales this workload',                         yaml: 'spec.scaleTargetRef.name' },
  [SourceField.RoleRef]:            { short: 'RoleBinding binds this Role',                      yaml: 'roleRef.name' },
  [SourceField.Subjects]:           { short: 'RoleBinding grants access to ServiceAccount',      yaml: 'subjects[].name' },
  [SourceField.OwnerReference]:     { short: 'Pod/ReplicaSet records its owner (set by K8s, not the user)', yaml: 'metadata.ownerReferences[].name' },
  [SourceField.IngressTLS]:         { short: 'Ingress TLS terminates with a Secret',             yaml: 'spec.tls[].secretName' },
};
