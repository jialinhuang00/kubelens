import { Component, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataModeService } from '../../../core/services/data-mode.service';

@Component({
  selector: 'app-mode-toggle',
  template: `
    <div class="mode-toggle">
      <button
        class="mode-btn"
        [class.mode-active]="!dataModeService.isSnapshotMode()"
        [disabled]="!dataModeService.realtimeAvailable()"
        (click)="select(false)">
        Realtime
      </button>
      <!-- Disabled buttons swallow mouse events, so the hover lives on a wrapper -->
      <span
        class="snap-wrap"
        (mouseenter)="onSnapshotHover(true)"
        (mouseleave)="onSnapshotHover(false)">
        <button
          class="mode-btn"
          [class.mode-active]="dataModeService.isSnapshotMode()"
          [disabled]="!dataModeService.snapshotAvailable()"
          (click)="select(true)">
          Snapshot
        </button>
        @if (showSnapshotHint()) {
          <button class="snap-popover" (click)="goExport()">
            No snapshot yet — export one from <span class="popover-link">Home</span>
          </button>
        }
      </span>
    </div>
  `,
  styles: [`
    .mode-toggle {
      display: flex;
      border-radius: 5px;
      /* no overflow: hidden — it would clip the snap-popover; round the end buttons instead */
      border: 1px solid var(--t-border);
      background: rgba(128, 128, 128, 0.03);
    }

    .mode-toggle > .mode-btn:first-child {
      border-radius: 4px 0 0 4px;
    }

    .snap-wrap .mode-btn {
      border-radius: 0 4px 4px 0;
    }

    .mode-btn {
      padding: 5px 12px;
      font-size: 11px;
      font-family: inherit;
      font-weight: 500;
      color: var(--t-text-secondary);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 72px;

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      &.mode-active {
        color: var(--t-text-on-accent);
        background: var(--t-accent);
      }
    }

    .snap-wrap {
      position: relative;
      display: inline-flex;
    }

    .snap-popover {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 1000;
      white-space: nowrap;
      padding: 8px 12px;
      font-size: 11px;
      font-family: inherit;
      color: var(--t-text-primary);
      background: var(--t-bg-panel);
      border: 1px solid var(--t-accent);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      text-align: left;

      &::before {
        content: '';
        position: absolute;
        top: -5px;
        right: 24px;
        width: 8px;
        height: 8px;
        transform: rotate(45deg);
        background: var(--t-bg-panel);
        border-left: 1px solid var(--t-accent);
        border-top: 1px solid var(--t-accent);
      }

      /* invisible bridge over the 8px gap so the pointer never "leaves" mid-travel */
      &::after {
        content: '';
        position: absolute;
        top: -9px;
        left: 0;
        right: 0;
        height: 9px;
      }

      .popover-link {
        color: var(--t-accent);
        text-decoration: underline;
      }
    }
  `],
})
export class ModeToggleComponent {
  protected readonly dataModeService = inject(DataModeService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  readonly modeChanged = output<boolean>();

  protected showSnapshotHint = signal(false);
  private hintHideTimer: ReturnType<typeof setTimeout> | null = null;

  onSnapshotHover(entering: boolean): void {
    if (this.hintHideTimer) {
      clearTimeout(this.hintHideTimer);
      this.hintHideTimer = null;
    }
    if (entering) {
      this.showSnapshotHint.set(!this.dataModeService.snapshotAvailable());
    } else {
      // Grace period so the pointer can travel from the button into the popover
      this.hintHideTimer = setTimeout(() => this.showSnapshotHint.set(false), 250);
    }
  }

  goExport(): void {
    this.showSnapshotHint.set(false);
    this.dataModeService.requestExportHint();
    this.router.navigate(['/']);
  }

  select(snapshot: boolean): void {
    const prev = this.dataModeService.isSnapshotMode();
    this.dataModeService.setSnapshotMode(snapshot);
    if (this.dataModeService.isSnapshotMode() !== prev) {
      const mode = snapshot ? 'Snapshot' : 'Realtime';
      this.snackBar.open(`Switched to ${mode} mode`, '', {
        duration: 2000,
        panelClass: 'mutation-snackbar',
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
    this.modeChanged.emit(snapshot);
  }
}
