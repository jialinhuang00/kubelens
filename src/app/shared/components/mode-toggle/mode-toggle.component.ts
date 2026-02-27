import { Component, inject, output } from '@angular/core';
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
      <button
        class="mode-btn"
        [class.mode-active]="dataModeService.isSnapshotMode()"
        [disabled]="!dataModeService.snapshotAvailable()"
        (click)="select(true)">
        Snapshot
      </button>
    </div>
  `,
  styles: [`
    .mode-toggle {
      display: flex;
      border-radius: 5px;
      overflow: hidden;
      border: 1px solid var(--t-border);
      background: rgba(128, 128, 128, 0.03);
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
  `],
})
export class ModeToggleComponent {
  protected readonly dataModeService = inject(DataModeService);
  readonly modeChanged = output<boolean>();

  select(snapshot: boolean): void {
    this.dataModeService.setSnapshotMode(snapshot);
    this.modeChanged.emit(snapshot);
  }
}
