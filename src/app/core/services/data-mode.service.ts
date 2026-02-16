import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DataModeService {
  private http = inject(HttpClient);

  isSnapshotMode = signal(false);
  snapshotAvailable = signal(false);
  realtimeAvailable = signal(false);
  kubectlVersion = signal('');

  async checkAvailability(): Promise<void> {
    await Promise.all([
      this.checkSnapshot(),
      this.checkRealtime(),
    ]);

    // Auto-select: prefer realtime, fallback to snapshot
    if (this.realtimeAvailable()) {
      this.isSnapshotMode.set(false);
    } else if (this.snapshotAvailable()) {
      this.isSnapshotMode.set(true);
    }
  }

  private async checkSnapshot(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ available: boolean }>('http://localhost:3000/api/snapshot-status')
      );
      this.snapshotAvailable.set(res.available);
    } catch {
      this.snapshotAvailable.set(false);
    }
  }

  private async checkRealtime(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ status: string; kubectl?: { version: string } }>('http://localhost:3000/api/health')
      );
      const healthy = res.status === 'healthy';
      this.realtimeAvailable.set(healthy);
      this.kubectlVersion.set(res.kubectl?.version || '');
    } catch {
      this.realtimeAvailable.set(false);
    }
  }

  toggle(): void {
    if (this.isSnapshotMode() && this.realtimeAvailable()) {
      this.isSnapshotMode.set(false);
    } else if (!this.isSnapshotMode() && this.snapshotAvailable()) {
      this.isSnapshotMode.set(true);
    }
  }

  setSnapshotMode(enabled: boolean): void {
    if (enabled && !this.snapshotAvailable()) return;
    if (!enabled && !this.realtimeAvailable()) return;
    this.isSnapshotMode.set(enabled);
  }
}
