import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KubeResource } from '../../../../shared/models/kubectl.models';
import { ClipboardService } from '../../../../shared/services/clipboard.service';
import { PodPhase } from '../../../universe/models/graph.models';

@Component({
  selector: 'app-one-table',
  imports: [CommonModule],
  templateUrl: './table-output.component.html',
  styleUrl: './table-output.component.scss'
})
export class TableOutputComponent {
  private clipboardService = inject(ClipboardService);
  readonly PodPhase = PodPhase;

  @Input() results: KubeResource[] = [];
  @Input() headers: string[] = [];
  @Input() isLoading: boolean = false;

  async onCopyToClipboard(text: string, event?: Event): Promise<void> {
    await this.clipboardService.copyToClipboard(text, event);
  }
}