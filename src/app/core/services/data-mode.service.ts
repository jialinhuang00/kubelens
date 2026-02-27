import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { K8sExportService } from './k8s-export.service';
import { API_BASE } from '../constants/api';

@Injectable({ providedIn: 'root' })
export class DataModeService {
  private static readonly STORAGE_KEY = 'kubecmds-data-mode';

  private http = inject(HttpClient);
  private exportService = inject(K8sExportService);

  // Eagerly restore saved preference so it's correct before any ping completes
  isSnapshotMode = signal(localStorage.getItem(DataModeService.STORAGE_KEY) === 'snapshot');
  snapshotAvailable = signal(false);
  realtimeAvailable = signal(false);
  kubectlVersion = signal('');

  async checkAvailability(): Promise<void> {
    await this.refreshAvailability();

    // Validate saved preference against what's actually available
    const saved = localStorage.getItem(DataModeService.STORAGE_KEY);
    if (saved === 'snapshot' && this.snapshotAvailable()) {
      this.isSnapshotMode.set(true);
    } else if (saved === 'realtime' && this.realtimeAvailable()) {
      this.isSnapshotMode.set(false);
    } else if (!saved) {
      // No preference saved — auto-select
      if (this.realtimeAvailable()) {
        this.isSnapshotMode.set(false);
      } else if (this.snapshotAvailable()) {
        this.isSnapshotMode.set(true);
      }
    } else {
      // Saved preference not available — fallback
      if (this.realtimeAvailable()) {
        this.isSnapshotMode.set(false);
      } else if (this.snapshotAvailable()) {
        this.isSnapshotMode.set(true);
      }
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
      this.persistMode();
    } else if (!this.isSnapshotMode() && this.snapshotAvailable()) {
      this.isSnapshotMode.set(true);
      this.persistMode();
    }
  }

  setSnapshotMode(enabled: boolean): void {
    if (enabled && !this.snapshotAvailable()) return;
    if (enabled && this.exportService.isRunning()) return;
    if (!enabled && !this.realtimeAvailable()) return;
    this.isSnapshotMode.set(enabled);
    this.persistMode();
  }

  private persistMode(): void {
    localStorage.setItem(DataModeService.STORAGE_KEY, this.isSnapshotMode() ? 'snapshot' : 'realtime');
  }
}
