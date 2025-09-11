/**
 * Execution Group Constants
 * 
 * Defines execution group constants for kubectl commands to control cancellation logic.
 * Structured management approach similar to GA events.
 */

export const EXECUTION_GROUPS = {
  /**
   * User-initiated commands
   * - Highest priority, cannot be cancelled by background tasks
   * - Will cancel other user commands and background tasks
   */
  USER_COMMAND: 'user-command',

  /**
   * Namespace-related operations
   * - Resource loading when switching namespaces
   */
  NAMESPACE: {
    RESOURCE_LOADING: 'namespace-resource-loading'
  },

  /**
   * Deployment-related operations
   * - All operations related to a specific deployment use the same group
   * - Includes status queries, history retrieval, monitoring, etc.
   */
  DEPLOYMENT: {
    OPERATIONS: 'deployment-ops'
  },

  /**
   * Service-related operations
   */
  SERVICE: {
    STATUS_QUERY: 'service-status'
  },

  /**
   * Pod-related operations
   */
  POD: {
    OPERATIONS: 'pod-ops'
  }
} as const;

/**
 * Execution Group Generator - Creates execution group names with dynamic parameters
 */
export class ExecutionGroupGenerator {
  
  /**
   * Generate user command group name
   * @returns Unique user command group name with timestamp
   */
  static userCommand(): string {
    return `${EXECUTION_GROUPS.USER_COMMAND}-${Date.now()}`;
  }

  /**
   * Generate namespace resource loading group name
   * @param namespace - Namespace name
   * @returns Namespace resource loading group name
   */
  static namespaceResourceLoading(namespace: string): string {
    return `${EXECUTION_GROUPS.NAMESPACE.RESOURCE_LOADING}-${namespace}-${Date.now()}`;
  }

  /**
   * Generate deployment operations group name
   * @param deployment - Deployment name
   * @param namespace - Namespace name
   * @returns Deployment operations group name
   */
  static deploymentOperations(deployment: string, namespace: string): string {
    return `${EXECUTION_GROUPS.DEPLOYMENT.OPERATIONS}-${deployment}-${namespace}`;
  }

  /**
   * Generate service status query group name
   * @param service - Service name
   * @param namespace - Namespace name
   * @returns Service status query group name
   */
  static serviceStatusQuery(service: string, namespace: string): string {
    return `${EXECUTION_GROUPS.SERVICE.STATUS_QUERY}-${service}-${namespace}-${Date.now()}`;
  }

  /**
   * Generate pod operations group name
   * @param pod - Pod name
   * @param namespace - Namespace name
   * @returns Pod operations group name
   */
  static podOperations(pod: string, namespace: string): string {
    return `${EXECUTION_GROUPS.POD.OPERATIONS}-${pod}-${namespace}-${Date.now()}`;
  }
}

/**
 * Execution Group Utils - Provides group name checking and analysis functionality
 */
export class ExecutionGroupUtils {
  
  /**
   * Check if group is a user command group
   * @param group - Group name
   * @returns Whether it's a user command group
   */
  static isUserCommand(group?: string): boolean {
    return group?.startsWith(EXECUTION_GROUPS.USER_COMMAND) ?? false;
  }

  /**
   * Check if group is a deployment operations group
   * @param group - Group name
   * @returns Whether it's a deployment operations group
   */
  static isDeploymentOperations(group?: string): boolean {
    return group?.startsWith(EXECUTION_GROUPS.DEPLOYMENT.OPERATIONS) ?? false;
  }

  /**
   * Check if group is a namespace resource loading group
   * @param group - Group name
   * @returns Whether it's a namespace resource loading group
   */
  static isNamespaceResourceLoading(group?: string): boolean {
    return group?.startsWith(EXECUTION_GROUPS.NAMESPACE.RESOURCE_LOADING) ?? false;
  }

  /**
   * Check if group is a service status query group
   * @param group - Group name
   * @returns Whether it's a service status query group
   */
  static isServiceStatusQuery(group?: string): boolean {
    return group?.startsWith(EXECUTION_GROUPS.SERVICE.STATUS_QUERY) ?? false;
  }

  /**
   * Get priority of a group (lower number = higher priority)
   * @param group - Group name
   * @returns Priority level
   */
  static getPriority(group?: string): number {
    if (this.isUserCommand(group)) return 1; // Highest priority
    if (this.isDeploymentOperations(group)) return 2;
    if (this.isNamespaceResourceLoading(group)) return 3;
    if (this.isServiceStatusQuery(group)) return 4;
    return 999; // Unknown groups have lowest priority
  }

  /**
   * Check if current group should cancel target group
   * @param currentGroup - Current execution group
   * @param targetGroup - Target group to potentially cancel
   * @returns Whether cancellation should occur
   */
  static shouldCancel(currentGroup?: string, targetGroup?: string): boolean {
    const currentPriority = this.getPriority(currentGroup);
    const targetPriority = this.getPriority(targetGroup);
    
    // Only higher or equal priority groups can cancel other groups
    return currentPriority <= targetPriority;
  }
}