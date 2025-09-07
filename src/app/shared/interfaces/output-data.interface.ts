export interface OutputData {
  outputType: 'table' | 'yaml' | 'multiple-tables' | 'multiple-yamls' | 'pod-describe' | 'events' | 'raw';
  isLoading: boolean;
  
  // Table data (required for components)
  results: any[];
  headers: string[];
  
  // YAML data
  yamlContent: string;
  
  // Multiple tables
  multipleTables: Array<{
    title: string;
    headers: string[];
    data: any[];
  }>;
  
  // Multiple YAMLs
  multipleYamls: Array<{
    title: string;
    yamlContent: string;
  }>;
  
  // Pod describe data
  podDescribeData: Array<{
    name: string;
    details: string;
    events: any[];
    headers: string[];
  }>;
  
  // Raw output
  commandOutput: string;
  customCommand: string;
  
  // Events data
  hasEventsTable: boolean;
  
  // UI state (now managed by UiStateService)
  // expandedTables, expandedYamls, expandedPods, isResourceDetailsExpanded
  // are now handled internally by components using UiStateService
}

export interface OutputEvents {
  copyText: (event: { text: string; event: Event }) => void;
  toggleTable: (title: string) => void;
  toggleYaml: (title: string) => void;
  togglePod: (name: string) => void;
  toggleResourceDetails: () => void;
}