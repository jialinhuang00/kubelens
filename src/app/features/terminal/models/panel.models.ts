import { OutputData } from '../../../shared/interfaces/output-data.interface';
import { CommandTemplate } from '../../../shared/models/kubectl.models';

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelState {
  id: string;
  type: 'resource' | 'general';
  resourceKind: string;
  resourceName: string;
  namespace: string;
  workspace: number;
  position: PanelPosition;
  size: PanelSize;
  zIndex: number;
  isMaximized: boolean;
  isLoading: boolean;
  isStreaming: boolean;
  outputData: OutputData;
  activeCommand: string;
  streamStop: (() => Promise<void>) | null;
  templates: CommandTemplate[];
}

export interface ResourceTreeNode {
  kind: string;
  label: string;
  color: string;
  items: string[];
  isExpanded: boolean;
  isLoading: boolean;
  count: number;
}

export const DEFAULT_RESOURCE_SIZE: PanelSize = { width: 600, height: 400 };
export const DEFAULT_GENERAL_SIZE: PanelSize = { width: 700, height: 300 };
export const CASCADE_OFFSET = 30;

export const EMPTY_OUTPUT_DATA: OutputData = {
  outputType: 'raw',
  isLoading: false,
  results: [],
  headers: [],
  yamlContent: '',
  multipleTables: [],
  multipleYamls: [],
  podDescribeData: [],
  commandOutput: '',
  customCommand: '',
  hasEventsTable: false,
};
