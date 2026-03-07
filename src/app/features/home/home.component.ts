import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataModeService } from '../../core/services/data-mode.service';
import { SnapshotService, ExportMode } from '../../core/services/snapshot.service';
import { TickFlashDirective } from '../../shared/directives/tick-flash.directive';
import { ThemeSwitcherComponent } from '../../shared/components/theme-switcher/theme-switcher.component';
import { HandbookComponent } from '../../shared/components/handbook/handbook.component';
import { MemMonitorComponent } from '../../shared/components/mem-monitor/mem-monitor.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TickFlashDirective, ThemeSwitcherComponent, HandbookComponent, MemMonitorComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  dataModeService = inject(DataModeService);
  exportService = inject(SnapshotService);
  showExport = signal(false);
  showModeDropdown = signal(false);

  workerLabel(): string {
    const labels: Record<string, string> = {
      'bash-batch': 'jobs',
      'bash-parallel': 'jobs',
      node: 'promises',
      workers: 'workers',
      procs: 'procs',
    };
    return labels[this.exportService.mode()] ?? '';
  }

  modeLabel(): string {
    const labels: Record<string, string> = {
      bash: 'bash',
      'bash-batch': 'bash-batch',
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
