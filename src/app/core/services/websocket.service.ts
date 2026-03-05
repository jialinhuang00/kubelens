import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface StreamData {
  streamId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

export interface StreamEnd {
  streamId: string;
  exitCode: number;
  fullOutput: string;
  timestamp: number;
}

export interface StreamError {
  streamId: string;
  error: string;
  timestamp: number;
}

export interface StreamSession {
  data$: Observable<StreamData>;
  end$: Observable<StreamEnd>;
  error$: Observable<StreamError>;
  close: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private wsBase = (() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/api/execute/stream/ws`;
  })();

  /**
   * Opens a WebSocket connection for one stream.
   * Sends { command, streamId, snapshot } as the first message.
   * Returns per-event observables + a close() to abort early.
   */
  connectStream(command: string, streamId: string, snapshot: boolean): StreamSession {
    let ws: WebSocket | null = null;
    let closed = false;

    const dataObservers: ((v: StreamData) => void)[] = [];
    const endObservers:  ((v: StreamEnd) => void)[]  = [];
    const errorObservers: ((v: StreamError) => void)[] = [];
    const completeCallbacks: (() => void)[] = [];

    const open = () => {
      ws = new WebSocket(this.wsBase);

      ws.onopen = () => {
        ws!.send(JSON.stringify({ command, streamId, snapshot }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case 'stream-data':
              dataObservers.forEach(fn => fn({
                streamId: msg.streamId,
                type: msg.dataType ?? 'stdout',
                data: msg.data,
                timestamp: msg.timestamp,
              }));
              break;
            case 'stream-end':
              endObservers.forEach(fn => fn({
                streamId: msg.streamId,
                exitCode: msg.exitCode,
                fullOutput: msg.fullOutput,
                timestamp: msg.timestamp,
              }));
              completeCallbacks.forEach(fn => fn());
              ws?.close();
              break;
            case 'stream-error':
              errorObservers.forEach(fn => fn({
                streamId: msg.streamId,
                error: msg.error,
                timestamp: msg.timestamp,
              }));
              completeCallbacks.forEach(fn => fn());
              ws?.close();
              break;
          }
        } catch { /* ignore malformed message */ }
      };

      ws.onerror = () => {
        if (!closed) {
          errorObservers.forEach(fn => fn({
            streamId,
            error: 'WebSocket connection error',
            timestamp: Date.now(),
          }));
        }
      };

      ws.onclose = () => {
        closed = true;
        completeCallbacks.forEach(fn => fn());
      };
    };

    open();

    const makeObs = <T>(arr: ((v: T) => void)[]): Observable<T> =>
      new Observable(observer => {
        const fn = (v: T) => observer.next(v);
        arr.push(fn);
        completeCallbacks.push(() => observer.complete());
        return () => {
          const i = arr.indexOf(fn);
          if (i >= 0) arr.splice(i, 1);
        };
      });

    return {
      data$:  makeObs<StreamData>(dataObservers),
      end$:   makeObs<StreamEnd>(endObservers),
      error$: makeObs<StreamError>(errorObservers),
      close: () => { closed = true; ws?.close(); },
    };
  }
}
