import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, merge, Subject } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { KubectlResponse } from '../../shared/models/kubectl.models';
import { WebSocketService } from './websocket.service';
import { ExecutionContextService } from './execution-context.service';
import { ExecutionGroupUtils } from '../../shared/constants/execution-groups.constants';

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
  private readonly API_BASE = 'http://localhost:3000/api';
  
  // Request cancellation and tracking
  private cancelSubjects = new Map<string, Subject<void>>();
  private activeExecutions = new Map<string, CommandExecution>();
  private executionHistory: CommandExecution[] = [];

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
    this.executionHistory.push(execution);

    // Cancel previous executions only if they're in different groups (or no group specified)
    if (!effectiveGroup) {
      // No group specified, cancel all OTHER pending executions (exclude current one)
      this.cancelSubjects.forEach((subject, key) => {
        if (key !== executionId) { // Don't cancel current execution
          const activeExecution = this.activeExecutions.get(key);
          if (activeExecution?.status === 'pending') {
            subject.next();
            activeExecution.status = 'cancelled';
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
      const response = await this.http.post<KubectlResponse>(`${this.API_BASE}/execute`, {
        command: command
      }).pipe(
        takeUntil(cancelSubject),
        catchError((error: any) => {
          console.log(`❌ Command error: ${command} (ID: ${execution.id}) - ${error.message}`);
          return of({
            success: false,
            stdout: '',
            error: `Network error: ${error.message}`
          });
        })
      ).toPromise();

      // Mark as completed and cleanup if this execution is still active
      const activeExecution = this.activeExecutions.get(executionId);
      if (activeExecution?.status === 'pending' && response) {
        activeExecution.status = 'completed';
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
    } catch (error: any) {
      // Cleanup first
      this.cancelSubjects.delete(executionId);
      this.activeExecutions.delete(executionId);

      // If it's a cancellation, don't treat as error and re-throw
      if (error.message === 'REQUEST_CANCELLED') {
        const activeExecution = this.activeExecutions.get(executionId);
        if (activeExecution) {
          activeExecution.status = 'cancelled';
        }
        // Re-throw cancellation error so UI can handle it appropriately
        throw error;
      }

      // Handle real errors
      const activeExecution = this.activeExecutions.get(executionId);
      if (activeExecution?.status === 'pending') {
        activeExecution.status = 'error';
        console.log(`❌ Command error: ${command} (ID: ${execution.id}) - ${error.message}`);
      }

      return {
        success: false,
        stdout: '',
        error: `Network error: ${error.message}`
      };
    }
  }

  // 串流執行 kubectl 指令 (適用於 rollout status 等長時間運行的指令)
  async executeCommandStream(command: string): Promise<StreamingResponse> {
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 確保 WebSocket 已連線
    if (!this.websocketService.isConnected()) {
      this.websocketService.connect();
      // 等待連線建立
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
      // 開始串流
      const response = await this.http.post<any>(`${this.API_BASE}/execute/stream`, {
        command,
        streamId
      }).toPromise();

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to start stream');
      }

      // 建立輸出流
      const outputSubject = new BehaviorSubject<string>('');
      let fullOutput = '';

      // 監聽串流數據
      const dataSubscription = this.websocketService.getStreamData(streamId).subscribe(data => {
        fullOutput += data.data;
        outputSubject.next(fullOutput);
      });

      // 監聽串流結束
      const endSubscription = this.websocketService.getStreamEnd(streamId).subscribe(endData => {
        outputSubject.next(endData.fullOutput);
        outputSubject.complete();
        dataSubscription.unsubscribe();
        endSubscription.unsubscribe();
      });

      // 監聽錯誤
      const errorSubscription = this.websocketService.getStreamError(streamId).subscribe(errorData => {
        outputSubject.error(new Error(errorData.error));
        dataSubscription.unsubscribe();
        endSubscription.unsubscribe();
        errorSubscription.unsubscribe();
      });

      // 停止函數
      const stop = async () => {
        try {
          await this.http.post(`${this.API_BASE}/execute/stream/stop`, {
            streamId
          }).toPromise();

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

  // 判斷指令是否需要串流執行
  shouldUseStream(command: string): boolean {
    const streamingCommands = [
      'rollout status',
      'logs -f',
      'get events -w',
      'wait'
    ];

    return streamingCommands.some(cmd => command.includes(cmd));
  }

  // Execution tracking methods
  getCurrentExecution(): CommandExecution | undefined {
    // Return the most recent pending execution
    for (const [id, execution] of this.activeExecutions) {
      if (execution.status === 'pending') {
        return execution;
      }
    }
    return undefined;
  }

  getActiveExecutions(): CommandExecution[] {
    return Array.from(this.activeExecutions.values()).filter(exec => exec.status === 'pending');
  }

  getExecutionHistory(): CommandExecution[] {
    return [...this.executionHistory];
  }

  clearExecutionHistory(): void {
    this.executionHistory = [];
  }

  removeHistoryItem(id: string): void {
    this.executionHistory = this.executionHistory.filter(cmd => cmd.id !== id);
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

  async getDeployments(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get deployments -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );

      if (response.success) {
        return response.stdout.trim().split(' ').filter(d => d);
      }

      return [];
    } catch (error) {
      console.error(`Failed to load deployments for namespace ${namespace}:`, error);
      return [];
    }
  }

  async getPods(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get pods -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );

      if (response.success) {
        return response.stdout.trim().split(' ').filter(p => p);
      }

      return [];
    } catch (error) {
      console.error(`Failed to load pods for namespace ${namespace}:`, error);
      return [];
    }
  }

  async getServices(namespace: string): Promise<string[]> {
    try {
      const response = await this.executeCommand(
        `kubectl get services -n ${namespace} -o jsonpath="{.items[*].metadata.name}"`
      );

      if (response.success) {
        return response.stdout.trim().split(' ').filter(s => s);
      }

      return [];
    } catch (error) {
      console.error(`Failed to load services for namespace ${namespace}:`, error);
      return [];
    }
  }
}