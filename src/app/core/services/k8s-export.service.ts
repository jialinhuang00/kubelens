import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface ExportProgress {
  running: boolean;
  paused: boolean;
  totalNamespaces: number;
  completedNamespaces: number;
  currentNamespace: string;
  currentResource: string;
  fileCount: number;
  etaSeconds: number | null;
  error: string | null;
}

const EXPORT_TIPS = [
  'Exporting snapshot...',
  'Large clusters may take a few minutes',
  'Good time for a stretch break',
  'Grabbing resources from every namespace',
  'Your cluster data is being preserved',
  'Almost like kubectl get everything',
  'Each namespace, one by one',
  'Go grab a coffee, we got this',
];

@Injectable({ providedIn: 'root' })
export class K8sExportService {
  private http = inject(HttpClient);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private tipTimer: ReturnType<typeof setInterval> | null = null;
  private tipIndex = 0;

  tip = signal(EXPORT_TIPS[0]);
  isRunning = signal(false);
  paused = signal(false);
  totalNs = signal(0);
  completedNs = signal(0);
  currentNamespace = signal('');
  currentResource = signal('');
  fileCount = signal(0);
  eta = signal('');
  progress = signal(0);
  error = signal<string | null>(null);
  done = signal(false);

  async checkState(): Promise<void> {
    if (this.pollTimer) return;

    try {
      const data = await firstValueFrom(
        this.http.get<ExportProgress>('http://localhost:3000/api/k8s-export/progress')
      );
      this.applyProgress(data);

      if (data.running) {
        this.isRunning.set(true);
        this.startPolling();
        this.startTipRotation();
      } else if (data.paused) {
        this.paused.set(true);
      }
    } catch {
      // server not available
    }
  }

  async startExport(resume = false): Promise<void> {
    this.done.set(false);
    this.error.set(null);
    this.paused.set(false);

    if (!resume) {
      this.completedNs.set(0);
      this.totalNs.set(0);
      this.fileCount.set(0);
      this.progress.set(0);
      this.currentNamespace.set('');
    }

    try {
      await firstValueFrom(
        this.http.post('http://localhost:3000/api/k8s-export/start', { resume })
      );
      this.isRunning.set(true);
      this.startPolling();
      this.startTipRotation();
    } catch (err: any) {
      this.error.set(err.message || 'Failed to start export');
    }
  }

  async pauseExport(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('http://localhost:3000/api/k8s-export/stop', {})
      );
    } catch {
      // ignore
    }
    this.stopPolling();
    this.stopTipRotation();
    this.isRunning.set(false);
    this.paused.set(true);
  }

  private applyProgress(data: ExportProgress): void {
    this.totalNs.set(data.totalNamespaces);
    this.completedNs.set(data.completedNamespaces);
    this.currentNamespace.set(data.currentNamespace);
    this.currentResource.set(data.currentResource);
    this.fileCount.set(data.fileCount);
    this.eta.set(data.etaSeconds != null ? this.formatEta(data.etaSeconds) : '');
    this.error.set(data.error);

    if (data.totalNamespaces > 0) {
      this.progress.set(Math.round((data.completedNamespaces / data.totalNamespaces) * 100));
    }
  }

  private formatEta(seconds: number): string {
    if (seconds < 60) return `~${seconds}s remaining`;
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `~${min}m ${sec}s remaining` : `~${min}m remaining`;
  }

  private startTipRotation(): void {
    if (this.tipTimer) return;
    this.tipIndex = 0;
    this.tip.set(EXPORT_TIPS[0]);
    this.tipTimer = setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % EXPORT_TIPS.length;
      this.tip.set(EXPORT_TIPS[this.tipIndex]);
    }, 4000);
  }

  private stopTipRotation(): void {
    if (this.tipTimer) {
      clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.fetchProgress(), 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchProgress(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<ExportProgress>('http://localhost:3000/api/k8s-export/progress')
      );

      this.applyProgress(data);

      if (!data.running) {
        this.stopPolling();
        this.stopTipRotation();
        this.isRunning.set(false);
        if (data.paused) {
          this.paused.set(true);
        } else if (!data.error) {
          this.done.set(true);
        }
      }
    } catch {
      // network error, keep polling
    }
  }
}
