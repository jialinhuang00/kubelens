import { Component, OnDestroy, HostListener, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from '../../../core/constants/api';

interface ServerMem { rss: number; heapUsed: number; heapTotal: number; }

@Component({
  selector: 'app-mem-monitor',
  standalone: true,
  template: `
    <button class="mem-btn" (click)="toggle()" [class.active]="visible()" title="Memory monitor (M)">
      <svg width="15" height="11" viewBox="0 0 22 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="11" cy="8" rx="10" ry="7"/>
        <circle cx="11" cy="8" r="3"/>
      </svg>
      <kbd>M</kbd>
    </button>
    @if (visible()) {
      <div class="mem-panel">
        <div class="mem-row">
          <span class="mem-label">Server RSS</span>
          <span class="mem-val">{{ server().rss }} MB</span>
        </div>
        <div class="mem-row">
          <span class="mem-label">Server heap</span>
          <span class="mem-val">{{ server().heapUsed }}/{{ server().heapTotal }} MB</span>
        </div>
        <div class="mem-row" [class.unsupported]="!hasPerfMemory"
             [title]="!hasPerfMemory ? 'performance.memory is Chrome-only (non-standard). Launch Chrome with --enable-precise-memory-info for accurate values.' : ''">
          <span class="mem-label">Browser heap{{ !hasPerfMemory ? ' ⓘ' : '' }}</span>
          <span class="mem-val">{{ hasPerfMemory ? browserUsed() + '/' + browserTotal() + ' MB' : 'n/a' }}</span>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }

    .mem-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 28px;
      padding: 0 6px;
      background: var(--t-bg-surface);
      border: 1px solid var(--t-border);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      color: var(--t-text-dim);
      &:hover { border-color: var(--t-accent); color: var(--t-accent); }
      &.active { border-color: var(--t-accent); background: rgba(232,184,102,0.12); color: var(--t-accent); }
    }
    kbd {
      font-family: monospace;
      font-size: 10px;
      font-weight: 700;
      color: inherit;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--t-border);
      border-bottom-width: 2px;
      border-radius: 3px;
      padding: 0 4px;
      line-height: 1.6;
      pointer-events: none;
    }

    .mem-panel {
      position: fixed;
      top: 44px;
      right: 12px;
      z-index: 9999;
      background: rgba(14,11,8,0.95);
      border: 1px solid var(--t-accent);
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
    .unsupported .mem-label, .unsupported .mem-val { color: #504030; }
  `],
})
export class MemMonitorComponent implements OnDestroy {
  private http = inject(HttpClient);
  private readonly API_BASE = API_BASE;

  readonly hasPerfMemory = !!(performance as any).memory;

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
