export type ResourceType =
  | 'deployments'
  | 'pods'
  | 'services'
  | 'cronjobs'
  | 'statefulsets'
  | 'jobs'
  | 'configmaps'
  | 'secrets'
  | 'persistentvolumeclaims'
  | 'serviceaccounts'
  | 'ingresses'
  | 'gateways'
  | 'httproutes'
  | 'daemonsets'
  | 'replicasets'
  | 'horizontalpodautoscalers'
  | 'networkpolicies'
  | 'roles'
  | 'rolebindings';

export interface KubeResource {
  [key: string]: string;
}

export interface CommandTemplate {
  id: string;
  name: string;
  command: string;
  displayCommand?: string; // Optional display version with placeholders
  top?: boolean;
  disabled?: boolean;
  requiresInput?: boolean; // If true, populate editable input instead of auto-executing
}

export interface KubectlResponse {
  success: boolean;
  stdout: string;
  stderr?: string;
  error?: string;
}

export interface TableData {
  title: string;
  headers: string[];
  data: KubeResource[];
}

export interface YamlItem {
  title: string;        // extracted from metadata.name
  yamlContent: string;  // individual object YAML
}

// K8s API response types (kubectl JSON output shapes)

export interface K8sCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastUpdateTime?: string;
}

export interface K8sContainerState {
  running?: { startedAt?: string };
  waiting?: { reason?: string; message?: string };
  terminated?: { exitCode?: number; reason?: string; message?: string; startedAt?: string; finishedAt?: string };
}

export interface K8sContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: K8sContainerState;
  image: string;
  containerID?: string;
}

export interface K8sServicePort {
  name?: string;
  port: number;
  targetPort: string | number;
  protocol?: string;
  nodePort?: number;
}

export interface K8sEndpointSubset {
  addresses?: Array<{ ip: string; targetRef?: { kind: string; name: string } }>;
  notReadyAddresses?: Array<{ ip: string; targetRef?: { kind: string; name: string } }>;
  ports?: Array<{ name?: string; port: number; protocol?: string }>;
}

export interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  involvedObject: { kind: string; name: string; namespace?: string };
  firstTimestamp?: string;
  lastTimestamp?: string;
  count?: number;
}

export type OutputType =
  | 'table'
  | 'multiple-tables'
  | 'multiple-yamls'
  | 'raw'
  | 'yaml'
  | 'streaming';

export interface ParsedOutput {
  type: OutputType;
  data?: KubeResource[];
  headers?: string[];
  rawOutput?: string;
  tables?: TableData[];
  yamls?: YamlItem[];
  yamlContent?: string;
}