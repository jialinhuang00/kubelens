import { Injectable, signal, computed } from '@angular/core';

export interface DialogExecution {
  id: string;
  command: string;
  status: 'pending' | 'completed' | 'cancelled' | 'error';
  group?: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class ExecutionDialogService {
  readonly isOpen = signal(false);
  readonly executions = signal<DialogExecution[]>([]);

  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private batchId = 0;
  private currentBatchId = 0;

  readonly progress = computed(() => {
    const execs = this.executions();
    if (execs.length === 0) return { completed: 0, total: 0, percent: 0 };
    const completed = execs.filter(e => e.status !== 'pending').length;
    return {
      completed,
      total: execs.length,
      percent: Math.round((completed / execs.length) * 100)
    };
  });

  readonly activeExecutions = computed(() =>
    this.executions().filter(e => e.status === 'pending')
  );

  readonly completedExecutions = computed(() =>
    this.executions().filter(e => e.status === 'completed')
  );

  readonly cancelledExecutions = computed(() =>
    this.executions().filter(e => e.status === 'cancelled')
  );

  readonly errorExecutions = computed(() =>
    this.executions().filter(e => e.status === 'error')
  );

  readonly hasErrors = computed(() =>
    this.executions().some(e => e.status === 'error')
  );

  readonly hasCancelled = computed(() =>
    this.executions().some(e => e.status === 'cancelled')
  );

  readonly allDone = computed(() => {
    const execs = this.executions();
    return execs.length > 0 && execs.every(e => e.status !== 'pending');
  });

  addExecution(exec: DialogExecution): void {
    this.clearTimers();

    // If all previous executions are done, start a new batch
    const current = this.executions();
    if (current.length === 0 || current.every(e => e.status !== 'pending')) {
      this.executions.set([exec]);
      this.currentBatchId = ++this.batchId;
    } else {
      this.executions.update(list => [...list, exec]);
    }

    this.isOpen.set(true);
  }

  updateExecution(id: string, status: DialogExecution['status']): void {
    this.executions.update(list =>
      list.map(e => e.id === id ? { ...e, status } : e)
    );

    // Check if all done after update
    const execs = this.executions();
    const allDone = execs.length > 0 && execs.every(e => e.status !== 'pending');
    if (allDone) {
      this.scheduleAutoHide();
    }
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  dismiss(): void {
    this.clearTimers();
    this.isOpen.set(false);
    this.executions.set([]);
  }

  private scheduleAutoHide(): void {
    this.clearTimers();
    // Only auto-hide if no errors or cancellations
    if (!this.hasErrors() && !this.hasCancelled()) {
      // Wait 2s then hide entirely
      this.autoHideTimer = setTimeout(() => {
        this.isOpen.set(false);
        this.executions.set([]);
      }, 2000);
    }
  }

  private clearTimers(): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }
}
