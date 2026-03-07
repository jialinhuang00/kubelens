import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataModeService } from './core/services/data-mode.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styleUrls: [],
})
export class App implements OnInit {
  private readonly dataModeService = inject(DataModeService);

  ngOnInit(): void {
    this.dataModeService.checkAvailability();
  }
}
