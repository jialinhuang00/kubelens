import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { K8sExportService } from './k8s-export.service';
import { API_BASE } from '../constants/api';

@Injectable({ providedIn: 'root' })
export class DataModeService {
  private http = inject(HttpClient);
  private exportService = inject(K8sExportService);

  isSnapshotMode = signal(false);
  snapshotAvailable = signal(false);
  realtimeAvailable = signal(false);
  kubectlVersion = signal('');

  async checkAvailability(): Promise<void> {
    await this.refreshAvailability();

    // Auto-select: prefer realtime, fallback to snapshot
    if (this.realtimeAvailable()) {
      this.isSnapshotMode.set(false);
    } else if (this.snapshotAvailable()) {
      this.isSnapshotMode.set(true);
    }
  }

  /** Re-check both endpoints without changing the current mode. */
  async refreshAvailability(): Promise<void> {
    await Promise.all([
      this.checkSnapshot(),
      this.checkRealtime(),
    ]);
  }

  private async checkSnapshot(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ available: boolean }>(`${API_BASE}/snapshot/ping`)
      );
      this.snapshotAvailable.set(res.available);
    } catch {
      this.snapshotAvailable.set(false);
    }
  }

  private async checkRealtime(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ status: string; kubectl?: { version: string } }>(`${API_BASE}/realtime/ping`)
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
    if (enabled && this.exportService.isRunning()) return;
    if (!enabled && !this.realtimeAvailable()) return;
    this.isSnapshotMode.set(enabled);
  }
}
