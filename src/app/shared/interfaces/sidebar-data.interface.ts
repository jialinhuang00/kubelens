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
  
  // Templates
  generalTemplates: any[];
  deploymentTemplates: any[];
  podTemplates: any[];
  serviceTemplates: any[];
  
  // UI expansion states
  isGeneralExpanded: boolean;
  isDeploymentExpanded: boolean;
  isPodSectionExpanded: boolean;
  isServiceSectionExpanded: boolean;
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