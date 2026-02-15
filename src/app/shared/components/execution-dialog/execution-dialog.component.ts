import { Component, inject, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExecutionDialogService } from '../../../core/services/execution-dialog.service';

@Component({
  selector: 'app-execution-dialog',
  imports: [CommonModule],
  templateUrl: './execution-dialog.component.html',
  styleUrl: './execution-dialog.component.scss'
})
export class ExecutionDialogComponent implements OnDestroy {
  protected dialogService = inject(ExecutionDialogService);
  protected showCancelled = signal(true);
  protected isExpanded = signal(false);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // When new executions start, expand if user hasn't dismissed
    effect(() => {
      const execs = this.dialogService.executions();
      if (execs.length > 0 && execs.some(e => e.status === 'pending')) {
        this.clearHideTimer();
      }
    });
  }

  ngOnDestroy(): void {
    this.clearHideTimer();
  }

  toggleExpand(): void {
    this.isExpanded.update(v => !v);
  }

  toggleCancelled(): void {
    this.showCancelled.update(v => !v);
  }

  onDismiss(): void {
    this.isExpanded.set(false);
    this.dialogService.dismiss();
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
