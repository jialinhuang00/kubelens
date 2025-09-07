import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, merge } from 'rxjs';
import { KubectlResponse } from '../../shared/models/kubectl.models';
import { WebSocketService } from './websocket.service';

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
  private readonly API_BASE = 'http://localhost:3000/api';

  async executeCommand(command: string): Promise<KubectlResponse> {
    try {
      const response = await this.http.post<KubectlResponse>(`${this.API_BASE}/execute`, {
        command: command
      }).toPromise();

      return response!;
      // return { "success": true, "stdout": "apiVersion: v1\nkind: Service\nmetadata:\n  annotations:\n    kubectl.kubernetes.io/last-applied-configuration: |\n      {\"apiVersion\":\"v1\",\"kind\":\"Service\",\"metadata\":{\"annotations\":{},\"labels\":{\"app\":\"number-service\"},\"name\":\"number-service\",\"namespace\":\"noah\"},\"spec\":{\"ports\":[{\"port\":80,\"protocol\":\"TCP\",\"targetPort\":3000}],\"selector\":{\"app\":\"number-service\"},\"type\":\"ClusterIP\"}}\n  creationTimestamp: \"2025-09-05T14:40:46Z\"\n  labels:\n    app: number-service\n  name: number-service\n  namespace: noah\n  resourceVersion: \"20129\"\n  uid: 600e2140-ea0e-4293-98a7-417bc1ab774c\nspec:\n  clusterIP: 10.96.15.216\n  clusterIPs:\n  - 10.96.15.216\n  internalTrafficPolicy: Cluster\n  ipFamilies:\n  - IPv4\n  ipFamilyPolicy: SingleStack\n  ports:\n  - port: 80\n    protocol: TCP\n    targetPort: 3000\n  selector:\n    app: number-service\n  sessionAffinity: None\n  type: ClusterIP\nstatus:\n  loadBalancer: {}\n" }
    } catch (error) {
      return {
        success: false,
        stdout: '',
        error: `Network error: ${error}`
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