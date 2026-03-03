import { OutputType } from '../models/kubectl.models';

export interface OutputData {
  outputType: OutputType;
  isLoading: boolean;
  
  // Table data (required for components)
  results: Record<string, string>[];
  headers: string[];
  
  // YAML data
  yamlContent: string;
  
  // Multiple tables
  multipleTables: Array<{
    title: string;
    headers: string[];
    data: Record<string, string>[];
  }>;
  
  // Multiple YAMLs
  multipleYamls: Array<{
    title: string;
    yamlContent: string;
  }>;
  
  // Raw output
  commandOutput: string;
  customCommand: string;
  
  // UI state (now managed by UiStateService)
  // expandedTables, expandedYamls, expandedPods, isResourceDetailsExpanded
  // are now handled internally by components using UiStateService
}