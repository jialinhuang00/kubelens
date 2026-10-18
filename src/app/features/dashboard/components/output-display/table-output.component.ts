import { Component, Input, inject, ChangeDetectionStrategy } from '@angular/core';

import { KubeResource } from '../../../../shared/models/kubectl.models';
import { ClipboardService } from '../../../../shared/services/clipboard.service';
import { PodPhase } from '../../../universe/models/graph.models';

@Component({
  selector: 'app-one-table',
  imports: [],
  templateUrl: './table-output.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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

  getColumnWidth(header: string, totalColumns: number): string | null {
    if (totalColumns !== 2) return null;
    const h = header.toLowerCase();
    if (h.includes('image') || h.includes('sha')) return '70%';
    if (h.includes('pod') || h.includes('name')) return '30%';
    return null;
  }
}