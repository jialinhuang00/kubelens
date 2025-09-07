export interface SidebarData {
  // Resource data
  namespaces: string[];
  selectedNamespace: string;
  deployments: string[];
  selectedDeployment: string;
  pods: string[];
  selectedPod: string;
  services: string[];
  selectedService: string;
  
  // Loading states
  isInitializing: boolean;
  isLoadingNamespaces: boolean;
  
  // Templates (guaranteed to be arrays, not undefined)
  generalTemplates: any[];
  deploymentTemplates: any[];
  rolloutTemplates: any[];
  podTemplates: any[];
  serviceTemplates: any[];
  
  // UI expansion states (now managed by UiStateService)
  // isGeneralExpanded, isDeploymentExpanded, isPodSectionExpanded, isServiceSectionExpanded
  // are now handled internally by components using UiStateService
}

export interface SidebarEvents {
  namespaceChange: (namespace: string) => void;
  deploymentChange: (deployment: string) => void;
  podChange: (pod: string) => void;
  serviceChange: (service: string) => void;
  templateExecute: (template: any) => void;
  toggleGeneralSection: () => void;
  toggleDeploymentSection: () => void;
  togglePodSection: () => void;
  toggleServiceSection: () => void;
}