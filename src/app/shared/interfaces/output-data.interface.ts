export interface OutputData {
  outputType: 'table' | 'yaml' | 'multiple-tables' | 'multiple-yamls' | 'pod-describe' | 'events' | 'raw';
  isLoading: boolean;
  
  // Table data
  results?: any[];
  headers?: string[];
  
  // YAML data
  yamlContent?: string;
  
  // Multiple tables
  multipleTables?: Array<{
    title: string;
    headers: string[];
    data: any[];
  }>;
  
  // Multiple YAMLs
  multipleYamls?: Array<{
    title: string;
    yamlContent: string;
  }>;
  
  // Pod describe data
  podDescribeData?: Array<{
    name: string;
    details: string;
    events: any[];
    headers: string[];
  }>;
  
  // Raw output
  commandOutput?: string;
  customCommand?: string;
  
  // Events data
  hasEventsTable?: boolean;
  
  // UI state
  expandedTables: Set<string>;
  expandedYamls: Set<string>;
  expandedPods: Set<string>;
  isResourceDetailsExpanded: boolean;
}

export interface OutputEvents {
  copyText: (event: { text: string; event: Event }) => void;
  toggleTable: (title: string) => void;
  toggleYaml: (title: string) => void;
  togglePod: (name: string) => void;
  toggleResourceDetails: () => void;
}