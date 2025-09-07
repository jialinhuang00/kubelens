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

export interface YamlItem {
  title: string;        // 從 metadata.name 提取
  yamlContent: string;  // 個別物件的 YAML
}

export interface ParsedOutput {
  type: 'table' | 'events' | 'multiple-pods' | 'multiple-tables' | 'multiple-yamls' | 'raw' | 'yaml';
  data?: KubeResource[];
  headers?: string[];
  rawOutput?: string;
  podData?: PodDescribeData[];
  tables?: TableData[];
  yamls?: YamlItem[];
  hasEventsTable?: boolean;
  yamlContent?: string;
}