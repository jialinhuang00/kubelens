import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KubeResource } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-table-output',
  imports: [CommonModule],
  templateUrl: './table-output.component.html',
  styleUrl: './table-output.component.scss'
})
export class TableOutputComponent {
  @Input() results: KubeResource[] = [];
  @Input() headers: string[] = [];
  @Input() isLoading: boolean = false;

  @Output() copyToClipboard = new EventEmitter<{ text: string, event?: Event }>();

  onCopyToClipboard(text: string, event?: Event) {
    this.copyToClipboard.emit({ text, event });
  }
}