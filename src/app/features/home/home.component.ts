import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataModeService } from '../../core/services/data-mode.service';
import { K8sExportService } from '../../core/services/k8s-export.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
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

  onExportDone() {
    this.dataModeService.checkAvailability();
    this.exportService.done.set(false);
  }
}
