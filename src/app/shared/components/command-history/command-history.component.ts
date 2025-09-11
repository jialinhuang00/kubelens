import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KubectlService, CommandExecution } from '../../../core/services/kubectl.service';

@Component({
  selector: 'app-command-history',
  imports: [CommonModule],
  templateUrl: './command-history.component.html',
  styleUrl: './command-history.component.scss'
})
export class CommandHistoryComponent {
  private kubectlService = inject(KubectlService);

  get cancelledCommands(): CommandExecution[] {
    return this.kubectlService.getExecutionHistory().filter(cmd => cmd.status === 'cancelled');
  }

  onRemoveHistory(id: string) {
    this.kubectlService.removeHistoryItem(id);
  }

  clearAllHistory() {
    this.kubectlService.clearExecutionHistory();
  }
}