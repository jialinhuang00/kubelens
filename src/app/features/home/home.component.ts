import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataModeService } from '../../core/services/data-mode.service';
import { SnapshotService, ExportMode } from '../../core/services/snapshot.service';
import { TickFlashDirective } from '../../shared/directives/tick-flash.directive';
import { HandbookComponent } from '../../shared/components/handbook/handbook.component';
import { MemMonitorComponent } from '../../shared/components/mem-monitor/mem-monitor.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TickFlashDirective, HandbookComponent, MemMonitorComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  dataModeService = inject(DataModeService);
  exportService = inject(SnapshotService);
  showExport = signal(false);
  showModeDropdown = signal(false);
  // Deleting a half-finished export is not undoable, so the button asks once.
  confirmDiscard = signal(false);

  /** True when the partial export came from one cluster and kubectl now points
   *  at another. Both names have to be known — an old snapshot with no recorded
   *  context is unknown, not mismatched. */
  contextMismatch = computed(() => {
    const from = this.exportService.snapshotContext();
    const now = this.exportService.currentContext();
    return !!from && !!now && from !== now;
  });

  workerLabel(): string {
    const labels: Record<string, string> = {
      bash: 'jobs',
      'bash-parallel': 'jobs',
      node: 'promises',
      workers: 'workers',
      procs: 'procs',
      go: 'namespaces',
    };
    return labels[this.exportService.mode()] ?? '';
  }

  modeLabel(): string {
    const labels: Record<string, string> = {
      bash: this.exportService.workers() === 1 ? 'bash — sequential' : 'bash — batch',
      'bash-parallel': 'bash-parallel',
      node: 'node — single thread',
      workers: 'workers — thread pool',
      procs: 'procs — subprocesses',
      go: 'go — ~6x faster',
      parallel: 'parallel — GNU parallel',
    };
    return labels[this.exportService.mode()] ?? this.exportService.mode();
  }
  ngOnInit() {
    this.dataModeService.checkAvailability();
    this.exportService.checkState();
  }

  startExport() {
    this.exportService.startExport(false);
  }

  resumeExport() {
    this.exportService.startExport(true);
  }

  pauseExport() {
    this.exportService.pauseExport();
  }

  discardAndRestart() {
    this.confirmDiscard.set(false);
    this.exportService.discardAndRestart();
  }

  keepPartial() {
    this.confirmDiscard.set(false);
    this.exportService.dismissError();
  }

  setMode(mode: ExportMode) {
    this.exportService.mode.set(mode);
  }

  setWorkers(event: Event) {
    const v = parseInt((event.target as HTMLInputElement).value, 10);
    if (v >= 1 && v <= 16) this.exportService.workers.set(v);
  }

  incrementWorkers() {
    const v = this.exportService.workers();
    if (v < 16) this.exportService.workers.set(v + 1);
  }

  decrementWorkers() {
    const v = this.exportService.workers();
    if (v > 1) this.exportService.workers.set(v - 1);
  }

  async onExportDone() {
    await this.dataModeService.checkAvailability();
    this.dataModeService.setSnapshotMode(true);
    this.exportService.done.set(false);
    this.showExport.set(false);
  }
}
