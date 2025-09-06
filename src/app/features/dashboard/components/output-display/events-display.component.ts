import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KubeResource } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-events-display',
  imports: [CommonModule],
  templateUrl: './events-display.component.html',
  styleUrl: './events-display.component.scss'
})
export class EventsDisplayComponent {
  @Input() commandOutput: string = '';
  @Input() results: KubeResource[] = [];
  @Input() headers: string[] = [];
  @Input() isResourceDetailsExpanded: boolean = false;

  @Output() toggleResourceDetails = new EventEmitter<void>();

  onToggleResourceDetails() {
    this.toggleResourceDetails.emit();
  }
}