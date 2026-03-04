import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MemMonitorComponent } from './shared/components/mem-monitor/mem-monitor.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MemMonitorComponent],
  template: '<router-outlet></router-outlet><app-mem-monitor/>',
  styleUrls: [],
})
export class App {}
