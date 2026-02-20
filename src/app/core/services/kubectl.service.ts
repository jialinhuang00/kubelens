import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, merge, Subject, firstValueFrom, of } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { KubectlResponse, ResourceType } from '../../shared/models/kubectl.models';
import { WebSocketService } from './websocket.service';
import { ExecutionContextService } from './execution-context.service';
import { ExecutionGroupUtils } from '../../shared/constants/execution-groups.constants';
import { ExecutionDialogService } from './execution-dialog.service';
import { API_BASE } from '../constants/api';

export interface CommandExecution {
  id: string;
  command: string;
  status: 'pending' | 'completed' | 'cancelled' | 'error';
  timestamp: number;
  group?: string;
  uuid: string;
}

export interface StreamingResponse {
  isStreaming: boolean;
  streamId?: string;
  output$?: Observable<string>;
  stop?: () => Promise<void>;
}

@Injectable({
  providedIn: 'root'
})
export class KubectlService {
  private http = inject(HttpClient);
  private websocketService = inject(WebSocketService);
  private executionContext = inject(ExecutionContextService);
  private executionDialog = inject(ExecutionDialogService);
  private readonly API_BASE = API_BASE;
  
  // Request cancellation and tracking
  private cancelSubjects = new Map<string, Subject<void>>();
  private activeExecutions = new Map<string, CommandExecution>();

  async executeCommand(command: string, group?: string): Promise<KubectlResponse> {
    const uuid = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const executionId = `cmd_${uuid}`;
    
    // Use provided group or get from execution context
    const effectiveGroup = group || this.executionContext.getCurrentGroup();
    
    // Create new execution tracking
    const execution: CommandExecution = {
      id: executionId,
      command,
      status: 'pending',
      timestamp: Date.now(),
      group: effectiveGroup,
      uuid
    };

    // Set up cancellation for this execution FIRST
    const cancelSubject = new Subject<void>();
    this.cancelSubjects.set(executionId, cancelSubject);
    this.activeExecutions.set(executionId, execution);

    // Notify dialog
    this.executionDialog.addExecution({
      id: executionId,
      command,
      status: 'pending',
      group: effectiveGroup,
      timestamp: execution.timestamp
    });

    // Cancel previous executions only if they're in different groups (or no group specified)
    if (!effectiveGroup) {
      // No group specified, cancel all OTHER pending executions (exclude current one)
      this.cancelSubjects.forEach((subject, key) => {
        if (key !== executionId) { // Don't cancel current execution
          const activeExecution = this.activeExecutions.get(key);
          if (activeExecution?.status === 'pending') {
            subject.next();
            activeExecution.status = 'cancelled';
            this.executionDialog.updateExecution(key, 'cancelled');
            console.log(`🚫 Command cancelled: ${activeExecution.command} (ID: ${activeExecution.id}) by ${executionId}`);
            this.cancelSubjects.delete(key);
            this.activeExecutions.delete(key);
          }
        }
      });
    } else {
      // Cancel only executions from different groups, but respect priority
      this.cancelSubjects.forEach((subject, key) => {
        if (key !== executionId) { // Don't cancel current execution
          const activeExecution = this.activeExecutions.get(key);
          if (activeExecution?.status === 'pending' && activeExecution.group !== effectiveGroup) {
            
            // Priority protection: use structured group priority system
            if (!ExecutionGroupUtils.shouldCancel(effectiveGroup, activeExecution.group)) {
              console.log(`🛡️ Protected higher priority command from cancellation: ${activeExecution.command} (ID: ${activeExecution.id}), Current: ${effectiveGroup}, Target: ${activeExecution.group}`);
              return; // Don't cancel higher priority command
            }
            
            subject.next();
            activeExecution.status = 'cancelled';
            this.executionDialog.updateExecution(key, 'cancelled');
            console.log(`🚫 Command cancelled (different group): ${activeExecution.command} (ID: ${activeExecution.id}) by ${executionId}`);
            this.cancelSubjects.delete(key);
            this.activeExecutions.delete(key);
          }
        }
      });
    }
    
    console.log(`🚀 Command started: ${command} (ID: ${execution.id}${effectiveGroup ? `, Group: ${effectiveGroup}` : ''})`);
    console.log(`📊 Active executions: ${this.activeExecutions.size}, Current execution registered: ${this.activeExecutions.has(executionId)}`);;

    try {
      const response = await firstValueFrom(this.http.post<KubectlResponse>(`${this.API_BASE}/execute`, {
        command: command
      }).pipe(
        takeUntil(cancelSubject),
        catchError((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`❌ Command error: ${command} (ID: ${execution.id}) - ${message}`);
          return of({
            success: false,
            stdout: '',
            error: `Network error: ${message}`
          });
        })
      ));

      // Mark as completed and cleanup if this execution is still active
      const activeExecution = this.activeExecutions.get(executionId);
      if (activeExecution?.status === 'pending' && response) {
        activeExecution.status = 'completed';
        this.executionDialog.updateExecution(executionId, 'completed');
        console.log(`✅ Command completed: ${command} (ID: ${execution.id})`);
      }

      // Cleanup
      this.cancelSubjects.delete(executionId);
      this.activeExecutions.delete(executionId);

      if (!response) {
        // Request was cancelled, throw special error instead of returning failed response
        throw new Error('REQUEST_CANCELLED');
      }
      return response;
    } catch (error: unknown) {
      // Cleanup first
      this.cancelSubjects.delete(executionId);
      this.activeExecutions.delete(executionId);

      // If it's a cancellation, don't treat as error and re-throw
      if (error instanceof Error && error.message === 'REQUEST_CANCELLED') {
        const activeExecution = this.activeExecutions.get(executionId);
        if (activeExecution) {
          activeExecution.status = 'cancelled';
        }
        this.executionDialog.updateExecution(executionId, 'cancelled');
        // Re-throw cancellation error so UI can handle it appropriately
        throw error;
      }

      // Handle real errors
      const activeExecution = this.activeExecutions.get(executionId);
      if (activeExecution?.status === 'pending') {
        activeExecution.status = 'error';
        const message = error instanceof Error ? error.message : String(error);
        this.executionDialog.updateExecution(executionId, 'error');
        console.log(`❌ Command error: ${command} (ID: ${execution.id}) - ${message}`);
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: '',
        error: `Network error: ${message}`
      };
    }
  }

  // Stream a long-running kubectl command (e.g. rollout status) via WebSocket
  async executeCommandStream(command: string): Promise<StreamingResponse> {
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Ensure WebSocket is connected
    if (!this.websocketService.isConnected()) {
      this.websocketService.connect();
      // Wait for connection
      await new Promise(resolve => {
        const checkConnection = () => {
          if (this.websocketService.isConnected()) {
            resolve(void 0);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    try {
      // Start stream
      const response = await firstValueFrom(this.http.post<any>(`${this.API_BASE}/execute/stream`, {
        command,
        streamId
      }));

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to start stream');
      }

      // Create output stream
      const outputSubject = new BehaviorSubject<string>('');
      let fullOutput = '';

      // Listen for stream data
      const dataSubscription = this.websocketService.getStreamData(streamId).subscribe(data => {
        fullOutput += data.data;
        outputSubject.next(fullOutput);
      });

      // Listen for stream end
      const endSubscription = this.websocketService.getStreamEnd(streamId).subscribe(endData => {
        outputSubject.next(endData.fullOutput);
        outputSubject.complete();
        dataSubscription.unsubscribe();
        endSubscription.unsubscribe();
      });

      // Listen for errors
      const errorSubscription = this.websocketService.getStreamError(streamId).subscribe(errorData => {
        outputSubject.error(new Error(errorData.error));
        dataSubscription.unsubscribe();
        endSubscription.unsubscribe();
        errorSubscription.unsubscribe();
      });

      // Stop function
      const stop = async () => {
        try {
          await firstValueFrom(this.http.post(`${this.API_BASE}/execute/stream/stop`, {
            streamId
          }));

          dataSubscription.unsubscribe();
          endSubscription.unsubscribe();
          errorSubscription.unsubscribe();
          outputSubject.complete();
        } catch (error) {
          console.error('Error stopping stream:', error);
        }
      };

      return {
        isStreaming: true,
        streamId,
        output$: outputSubject.asObservable(),
        stop
      };

    } catch (error) {
      return {
        isStreaming: false,
        streamId: undefined,
        output$: undefined,
        stop: undefined
      };
    }
  }

  // Check if command requires streaming execution
  shouldUseStream(command: string): boolean {
    const streamingCommands = [
      'rollout status',
      'logs -f',
      'get events -w',
      'wait'
    ];

    return streamingCommands.some(cmd => command.includes(cmd));
  }

  async getResourceCounts(namespace: string): Promise<Record<string, number>> {
    try {
      const response = await firstValueFrom(this.http.get<{ success: boolean; counts: Record<string, number> }>(
        `${this.API_BASE}/resource-counts`, { params: { namespace } }
      ));
      return response.counts || {};
    } catch (error) {
      console.error('Failed to load resource counts:', error);
      return {};
    }
  }

  async getResourceNames(resourceType: ResourceType, namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get ${resourceType} -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );
      if (response.success) {
        return response.stdout.trim().split(' ').filter(n => n);
      }
      return [];
    } catch (error) {
      console.error(`Failed to load ${resourceType} for namespace ${namespace}:`, error);
      return [];
    }
  }

  async getNamespaces(): Promise<string[]> {
    try {
      const response = await this.executeCommand('kubectl get namespaces -o jsonpath="{.items[*].metadata.name}"');

      if (response.success) {
        return response.stdout.trim().split(' ').filter(ns => ns);
      }

      // Fallback namespaces if command fails
      return [];
    } catch (error) {
      console.error('Failed to load namespaces:', error);
      return [];
    }
  }

}