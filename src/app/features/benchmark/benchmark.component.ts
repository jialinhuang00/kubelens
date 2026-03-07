import { Component, signal, afterNextRender } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RACE_GROUPS, TCP_ROWS, PRIM_CARDS, RaceItem, RaceGroup } from './benchmark.data';
import { ThemeSwitcherComponent } from '../../shared/components/theme-switcher/theme-switcher.component';

@Component({
  selector: 'app-benchmark',
  standalone: true,
  imports: [RouterLink, ThemeSwitcherComponent],
  templateUrl: './benchmark.component.html',
  styleUrl: './benchmark.component.scss',
})
export class BenchmarkComponent {
  readonly groups = RACE_GROUPS;
  readonly tcpRows = TCP_ROWS;
  readonly primCards = PRIM_CARDS;

  openGroups = signal<Set<number>>(new Set([0]));
  selectedItems = signal<Map<number, RaceItem>>(new Map([[0, RACE_GROUPS[0].items[0]]]));
  activeSection = signal('race');
  private _compareOpen = signal(false);
  get compareOpen() { return this._compareOpen; }
  openCompare()  { this._compareOpen.set(true);  document.body.style.overflow = 'hidden'; }
  closeCompare() { this._compareOpen.set(false); document.body.style.overflow = ''; }

  // Flat list of all {group, item} for compare dropdown
  readonly flatItems: Array<{ group: RaceGroup; item: RaceItem; flat: number }> = [];

  // Default: Go ns=7 (best), Node single jobs=7 (best), Bash GNU parallel (best)
  compareSelections = signal<number[]>([]);

  private initCompare(): void {
    let idx = 0;
    for (const g of RACE_GROUPS) {
      for (const item of g.items) {
        this.flatItems.push({ group: g, item, flat: idx++ });
      }
    }
    // Pick 3 defaults: best from Go, Node single, Bash GNU parallel
    const bestGo      = this.flatItems.findIndex(f => f.group.label === 'Go' && f.item.best);
    const bestNode    = this.flatItems.findIndex(f => f.group.label === 'Node.js — single thread' && f.item.best);
    const bestBash    = this.flatItems.findIndex(f => f.group.label === 'Bash — GNU parallel' && f.item.best);
    this.compareSelections.set([bestGo, bestNode, bestBash].filter(i => i >= 0));
  }

  getCmpItem(flatIdx: number) {
    return this.flatItems[flatIdx];
  }

  getFlatIdx(g: RaceGroup, item: RaceItem): number {
    return this.flatItems.findIndex(f => f.group === g && f.item === item);
  }

  bestCmpCol(): number {
    const sels = this.compareSelections();
    let best = 0;
    let bestTime = Infinity;
    sels.forEach((flatIdx, ci) => {
      const t = this.flatItems[flatIdx]?.item.time ?? Infinity;
      if (t < bestTime) { bestTime = t; best = ci; }
    });
    return best;
  }

  setCmpCol(col: number, flatIdx: number): void {
    const s = [...this.compareSelections()];
    s[col] = flatIdx;
    this.compareSelections.set(s);
  }

  addCmpCol(): void {
    const used = new Set(this.compareSelections());
    const next = this.flatItems.findIndex(f => !used.has(f.flat));
    if (next >= 0) this.compareSelections.set([...this.compareSelections(), next]);
  }

  removeCmpCol(col: number): void {
    const s = [...this.compareSelections()];
    s.splice(col, 1);
    this.compareSelections.set(s);
  }

  // Token bucket
  bucketMode = signal<'slow' | 'fast'>('slow');
  bTokens = signal(10);
  bQueued = signal(0);
  bTotal = signal(0);

  private bucketQps = 5;
  private bucketBurst = 10;
  private tokensF = 10.0;
  private tokenFrac = 0.0;
  private totalServed = 0;
  private requests: Array<{
    x: number; y: number;
    state: 'flying' | 'waiting' | 'served';
    tx: number; ty: number; waitMs: number;
  }> = [];
  private lastTick = 0;
  private bucketRaf: number | null = null;
  private canvas!: HTMLCanvasElement;

  constructor() {
    this.initCompare();
    afterNextRender(() => {
      this.canvas = document.getElementById('bucketCanvas') as HTMLCanvasElement;
      // Defer first draw so canvas has its CSS layout size
      requestAnimationFrame(() => { this.drawBucket(); this.startBucketLoop(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeCompare();
      });
      this.setupNavTracking();
      // Animate bars after render
      setTimeout(() => {
        document.querySelectorAll<HTMLElement>('.race-bar[data-pct]').forEach(b => {
          b.style.width = b.dataset['pct'] + '%';
        });
      }, 100);
    });
  }

  isOpen(idx: number): boolean { return this.openGroups().has(idx); }

  toggleGroup(idx: number): void {
    const s = new Set(this.openGroups());
    s.has(idx) ? s.delete(idx) : s.add(idx);
    this.openGroups.set(s);
  }

  selectItem(groupIdx: number, item: RaceItem): void {
    const m = new Map(this.selectedItems());
    m.set(groupIdx, item);
    this.selectedItems.set(m);
    if (!this.isOpen(groupIdx)) {
      const s = new Set(this.openGroups());
      s.add(groupIdx);
      this.openGroups.set(s);
    }
    setTimeout(() => {
      document.getElementById(`detail-${groupIdx}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  getSelected(groupIdx: number): RaceItem | undefined {
    return this.selectedItems().get(groupIdx);
  }

  isSelected(groupIdx: number, item: RaceItem): boolean {
    return this.selectedItems().get(groupIdx) === item;
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  barPct(t: number): number {
    return Math.sqrt(t) / Math.sqrt(320) * 100;
  }

  // ── Token bucket ──────────────────────────────────────────────

  setBucketMode(mode: 'slow' | 'fast'): void {
    this.bucketMode.set(mode);
    this.bucketQps   = mode === 'slow' ? 5   : 100;
    this.bucketBurst = mode === 'slow' ? 10  : 200;
    this.resetBucket();
  }

  fireBurst(): void {
    const W   = this.canvas?.offsetWidth || 380;
    const H   = this.canvas?.offsetHeight || 300;
    const bx  = Math.round(W * 0.29);
    const by  = Math.round(H * 0.15);
    const bh  = Math.round(H * 0.60);
    for (let i = 0; i < 30; i++) {
      this.requests.push({
        x: W + 20 + i * 12,
        y: by + 20 + Math.random() * (bh - 40),
        state: 'flying', tx: 0, ty: 0, waitMs: 0,
      });
    }
  }

  resetBucket(): void {
    this.tokensF     = this.bucketBurst;
    this.tokenFrac   = 0;
    this.totalServed = 0;
    this.requests    = [];
    this.lastTick    = 0;
    this.bTokens.set(this.bucketBurst);
    this.bQueued.set(0);
    this.bTotal.set(0);
  }

  bucketWaitLabel(): string {
    return this.bucketQps === 5 ? '~18s' : '<0.1s';
  }

  private startBucketLoop(): void {
    if (this.bucketRaf) return;
    const tick = (ts: number) => {
      const now = ts / 1000;
      const dt  = this.lastTick ? Math.min(now - this.lastTick, 0.05) : 0;
      this.lastTick = now;
      this.updateBucket(dt);
      this.drawBucket();
      this.bucketRaf = requestAnimationFrame(tick);
    };
    this.bucketRaf = requestAnimationFrame(tick);
  }

  private updateBucket(dt: number): void {
    // Refill tokens using fractional accumulator
    this.tokenFrac += this.bucketQps * dt;
    const toAdd = Math.floor(this.tokenFrac);
    if (toAdd > 0) {
      this.tokensF   = Math.min(this.bucketBurst, this.tokensF + toAdd);
      this.tokenFrac -= toAdd;
    }

    const W  = this.canvas?.offsetWidth  || 380;
    const H  = this.canvas?.offsetHeight || 300;
    const bx = Math.round(W * 0.29);
    const by = Math.round(H * 0.15);
    const bw = Math.round(W * 0.42);
    const bh = Math.round(H * 0.60);
    const SPEED = 180;

    this.requests.forEach(req => {
      if (req.state === 'flying') {
        req.x -= SPEED * dt;
        if (req.x <= bx + bw) {
          if (this.tokensF >= 1) {
            this.tokensF -= 1;
            this.totalServed++;
            req.state = 'served';
            req.tx = 10 + Math.random() * (bx - 20);
            req.ty = by + 10 + Math.random() * (bh - 20);
          } else {
            req.state = 'waiting';
            req.x = bx + bw + 2;
          }
        }
      } else if (req.state === 'waiting') {
        req.waitMs += dt * 1000;
        if (this.tokensF >= 1) {
          this.tokensF -= 1;
          this.totalServed++;
          req.state = 'served';
          req.tx = 10 + Math.random() * (bx - 20);
          req.ty = by + 10 + Math.random() * (bh - 20);
        }
      } else if (req.state === 'served') {
        req.x += (req.tx - req.x) * 0.12;
        req.y += (req.ty - req.y) * 0.12;
        req.waitMs += dt * 1000;
      }
    });

    // Remove served requests that have settled
    this.requests = this.requests.filter(r =>
      !(r.state === 'served' && Math.abs(r.x - r.tx) < 2 && Math.abs(r.y - r.ty) < 2 && r.waitMs > 300)
    );

    this.bTokens.set(Math.floor(this.tokensF));
    this.bQueued.set(this.requests.filter(r => r.state === 'waiting').length);
    this.bTotal.set(this.totalServed);
  }

  private drawBucket(): void {
    if (!this.canvas) return;

    // HiDPI: sync drawing buffer while keeping CSS display size fixed
    const dpr  = window.devicePixelRatio || 1;
    const cssW = this.canvas.offsetWidth  || 380;
    const cssH = this.canvas.offsetHeight || 300;
    const bufW = Math.round(cssW * dpr);
    const bufH = Math.round(cssH * dpr);
    if (this.canvas.width !== bufW || this.canvas.height !== bufH) {
      this.canvas.width  = bufW;
      this.canvas.height = bufH;
      this.canvas.style.width  = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = cssW, H = cssH;
    const cs  = getComputedStyle(document.documentElement);
    const get = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb;
    const bg      = get('--t-bg-body',    '#0e0b08');
    const accent  = get('--t-accent',     '#e8b866');
    const success = get('--t-success',    '#6dca82');
    const error   = get('--t-error',      '#e07070');
    const text    = get('--t-text',       '#e8dcc8');
    const textDim = get('--t-text-dim',   '#a09080');

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Bucket geometry (proportional to canvas size)
    const bx = Math.round(W * 0.29);
    const by = Math.round(H * 0.15);
    const bw = Math.round(W * 0.42);
    const bh = Math.round(H * 0.60);

    const tok   = Math.floor(this.tokensF);
    const burst = this.bucketBurst;
    const pct   = tok / burst;
    const fillH = Math.max(0, bh * pct);
    const fillY = by + bh - fillH;

    // Trapezoid path (bucket shape — slightly wider at top)
    const trapezoid = () => {
      ctx.beginPath();
      ctx.moveTo(bx - 8, by);
      ctx.lineTo(bx + bw + 8, by);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx, by + bh);
      ctx.closePath();
    };

    // Fill background
    trapezoid(); ctx.fillStyle = bg; ctx.fill();

    // Token fill level
    if (fillH > 0) {
      ctx.save();
      trapezoid(); ctx.clip();
      ctx.fillStyle = 'rgba(232,184,102,0.22)';
      ctx.fillRect(bx - 8, fillY, bw + 16, fillH);
      ctx.restore();
    }

    // Bucket outline — color reflects level
    trapezoid();
    ctx.strokeStyle = tok < burst * 0.3 ? error : tok < burst * 0.7 ? '#d4956a' : accent;
    ctx.lineWidth = 2; ctx.stroke();

    // Token count label
    ctx.fillStyle = text; ctx.font = `bold 13px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center';
    ctx.fillText(`${tok} / ${burst} tokens`, bx + bw / 2, by + bh + 22);

    // Refill rate label + downward arrow above bucket
    ctx.fillStyle = success; ctx.font = `11px 'IBM Plex Mono', monospace`;
    ctx.fillText(`+${this.bucketQps} tokens/s`, bx + bw / 2, by - 16);
    const ax = bx + bw / 2;
    ctx.beginPath(); ctx.moveTo(ax, by - 4); ctx.lineTo(ax - 5, by - 13); ctx.lineTo(ax + 5, by - 13);
    ctx.closePath(); ctx.fillStyle = success; ctx.fill();

    // Draw request particles
    this.requests.forEach(req => {
      ctx.beginPath(); ctx.arc(req.x, req.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = req.state === 'waiting' ? error : req.state === 'served' ? success : text;
      ctx.fill();
    });

    // Served / queued summary below label
    const queued = this.bQueued();
    if (queued > 0) {
      ctx.fillStyle = error; ctx.font = `11px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center';
      ctx.fillText(`${queued} queued`, bx + bw / 2, by + bh + 42);
    } else if (this.totalServed > 0) {
      ctx.fillStyle = textDim; ctx.font = `11px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center';
      ctx.fillText(`${this.totalServed} served`, bx + bw / 2, by + bh + 42);
    }
  }

  private setupNavTracking(): void {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) this.activeSection.set(e.target.id); });
    }, { threshold: 0.3 });
    document.querySelectorAll('.bench-section').forEach(s => obs.observe(s));
  }
}
