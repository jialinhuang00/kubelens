import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataModeService } from '../../core/services/data-mode.service';
import { K8sExportService, ExportMode } from '../../core/services/k8s-export.service';
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
  exportService = inject(K8sExportService);
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

  async onExportDone() {
    await this.dataModeService.checkAvailability();
    this.dataModeService.setSnapshotMode(true);
    this.exportService.done.set(false);
  }
}
