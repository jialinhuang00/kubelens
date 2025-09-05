export interface KubeResource {
  [key: string]: any;
}

export interface PodDescribeData {
  name: string;
  details: string;
  events: KubeResource[];
  headers: string[];
}

export interface CommandTemplate {
  id: string;
  name: string;
  command: string;
  displayCommand?: string; // Optional display version with placeholders
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

export interface ParsedOutput {
  type: 'table' | 'events' | 'multiple-pods' | 'multiple-tables' | 'raw';
  data?: KubeResource[];
  headers?: string[];
  rawOutput?: string;
  podData?: PodDescribeData[];
  tables?: TableData[];
  hasEventsTable?: boolean;
}