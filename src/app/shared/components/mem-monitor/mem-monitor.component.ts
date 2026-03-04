import { Component, OnDestroy, HostListener, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from '../../../core/constants/api';

interface ServerMem { rss: number; heapUsed: number; heapTotal: number; }

@Component({
  selector: 'app-mem-monitor',
  standalone: true,
  template: `
    <div class="mem-wrap">
      @if (visible()) {
        <div class="mem-monitor">
          <div class="mem-row">
            <span class="mem-label">Server RSS</span>
            <span class="mem-val">{{ server().rss }} MB</span>
          </div>
          <div class="mem-row">
            <span class="mem-label">Server heap</span>
            <span class="mem-val">{{ server().heapUsed }}/{{ server().heapTotal }} MB</span>
          </div>
          <div class="mem-row">
            <span class="mem-label">Browser heap</span>
            <span class="mem-val">{{ browserUsed() }}/{{ browserTotal() }} MB</span>
          </div>
        </div>
      }
      <button class="mem-badge" (click)="toggle()" [class.active]="visible()" title="Memory monitor (M)">
        <kbd>M</kbd>
      </button>
    </div>
  `,
  styles: [`
    .mem-wrap {
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .mem-monitor {
      background: rgba(14,11,8,0.92);
      border: 1px solid #e8b866;
      border-radius: 4px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 11px;
      color: #e8dcc8;
      min-width: 200px;
    }
    .mem-row { display: flex; justify-content: space-between; gap: 16px; line-height: 1.8; }
    .mem-label { color: #a09078; }
    .mem-val { color: #e8b866; font-weight: bold; }
    .mem-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 20px;
      background: rgba(14,11,8,0.7);
      border: 1px solid #403020;
      border-radius: 3px;
      cursor: pointer;
      transition: border-color 0.15s;
      padding: 0;
      &:hover { border-color: #e8b866; }
      &.active { border-color: #e8b866; background: rgba(232,184,102,0.12); }
    }
    kbd {
      font-family: monospace;
      font-size: 10px;
      font-weight: 700;
      color: #a09078;
      background: none;
      border: none;
      padding: 0;
      pointer-events: none;
    }
    .mem-badge.active kbd { color: #e8b866; }
  `],
})
export class MemMonitorComponent implements OnDestroy {
  private http = inject(HttpClient);
  private readonly API_BASE = API_BASE;

  visible = signal(false);
  server = signal<ServerMem>({ rss: 0, heapUsed: 0, heapTotal: 0 });
  browserUsed = signal(0);
  browserTotal = signal(0);

  private timer: ReturnType<typeof setInterval> | null = null;

  @HostListener('window:keydown.m', ['$event'])
  onKey(e: Event) {
    if (((e as KeyboardEvent).target as HTMLElement)?.tagName === 'INPUT') return;
    this.toggle();
  }

  toggle() {
    this.visible.update(v => !v);
    if (this.visible()) {
      this.poll();
      this.timer = setInterval(() => this.poll(), 1000);
    } else {
      this.stopTimer();
    }
  }

  private poll() {
    this.http.get<ServerMem>(`${this.API_BASE}/debug/memory`).subscribe(m => this.server.set(m));

    const perf = (performance as any).memory;
    if (perf) {
      this.browserUsed.set(Math.round(perf.usedJSHeapSize  / 1024 / 1024));
      this.browserTotal.set(Math.round(perf.totalJSHeapSize / 1024 / 1024));
    }
  }

  private stopTimer() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  ngOnDestroy() { this.stopTimer(); }
}
