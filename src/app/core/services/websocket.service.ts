import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: Socket;
  private streamDataSubject = new Subject<StreamData>();
  private streamEndSubject = new Subject<StreamEnd>();
  private streamErrorSubject = new Subject<StreamError>();

  // public Observable
  streamData$ = this.streamDataSubject.asObservable();
  streamEnd$ = this.streamEndSubject.asObservable();
  streamError$ = this.streamErrorSubject.asObservable();

  isConnected = signal<boolean>(false);

  constructor() {
    this.socket = io('http://localhost:3000', {
      autoConnect: false
    });

    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.isConnected.set(true);
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.isConnected.set(false);
    });

    this.socket.on('stream-data', (data: StreamData) => {
      this.streamDataSubject.next(data);
    });

    this.socket.on('stream-end', (data: StreamEnd) => {
      this.streamEndSubject.next(data);
    });

    this.socket.on('stream-error', (data: StreamError) => {
      this.streamErrorSubject.next(data);
    });
  }

  connect() {
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  disconnect() {
    if (this.socket.connected) {
      this.socket.disconnect();
    }
  }

  // filtering data for specific streamId
  getStreamData(streamId: string): Observable<StreamData> {
    return new Observable(observer => {
      const subscription = this.streamData$.subscribe(data => {
        if (data.streamId === streamId) {
          observer.next(data);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  getStreamEnd(streamId: string): Observable<StreamEnd> {
    return new Observable(observer => {
      const subscription = this.streamEnd$.subscribe(data => {
        if (data.streamId === streamId) {
          observer.next(data);
          observer.complete();
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  getStreamError(streamId: string): Observable<StreamError> {
    return new Observable(observer => {
      const subscription = this.streamError$.subscribe(data => {
        if (data.streamId === streamId) {
          observer.next(data);
          observer.complete();
        }
      });

      return () => subscription.unsubscribe();
    });
  }
}