import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NamespaceService } from '../../../k8s/services/namespace.service';
import { PanelManagerService } from '../../services/panel-manager.service';
import { PanelExecutionService } from '../../services/panel-execution.service';
import { DataModeService } from '../../../../core/services/data-mode.service';

/**
 * Bottom command bar for the terminal main area: quick actions + a free-form
 * `kubectl` input. Moved out of the sidebar so the tree owns the left rail and
 * commands sit under the panels they produce.
 */
@Component({
  selector: 'app-command-bar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="command-bar">
      <div class="quick-actions">
        <button class="quick-btn" (click)="onQuickAction('get-all')">get all</button>
        <button class="quick-btn" (click)="onQuickAction('events')">events</button>
        <button class="quick-btn" (click)="onQuickAction('warnings')">warnings</button>
        <button class="quick-btn" (click)="onQuickAction('nodes')">nodes</button>
        @if (!isSnapshot()) {
          <button class="quick-btn" (click)="onQuickAction('top-nodes')">top nodes</button>
        }
        @if (ns()) {
          <button class="quick-btn" (click)="onQuickAction('pods')">pods</button>
          <button class="quick-btn" (click)="onQuickAction('services')">services</button>
          <button class="quick-btn" (click)="onQuickAction('endpoints')">endpoints</button>
          <button class="quick-btn" (click)="onQuickAction('pvc')">pvc</button>
          <button class="quick-btn" (click)="onQuickAction('images')">images</button>
          @if (!isSnapshot()) {
            <button class="quick-btn" (click)="onQuickAction('top-pods')">top pods</button>
          }
        }
      </div>
      <div class="input-row">
        <span class="prompt">{{ ns() || 'all' }} $</span>
        <input
          class="command-input"
          type="text"
          placeholder="kubectl ..."
          [ngModel]="customCommand()"
          (ngModelChange)="customCommand.set($event)"
          (keydown)="onCommandKeyDown($event)"
        />
        <button class="run-btn" [disabled]="!customCommand().trim()" (click)="onExecuteCustomCommand()">
          <span class="hint">⌘↵</span> Run
        </button>
      </div>
    </div>
  `,
  styles: [`
    .command-bar {
      flex-shrink: 0;
      padding: 10px 14px;
      border-top: 1px solid var(--t-border);
      background: var(--t-bg-panel);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    .quick-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
    .quick-btn {
      font-size: 11px;
      padding: 3px 10px;
      border: 1px solid var(--t-border);
      border-radius: var(--t-radius-sm);
      background: transparent;
      color: var(--t-text-dim);
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .quick-btn:hover { border-color: var(--t-accent); color: var(--t-text-primary); }
    .input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--t-border);
      border-radius: var(--t-radius-sm);
      padding: 6px 11px;
      background: var(--t-bg-output);
    }
    .input-row:focus-within { border-color: var(--t-accent); }
    .prompt { color: var(--t-success); font-size: 12px; flex-shrink: 0; }
    .command-input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--t-text-primary);
      font-family: inherit;
      font-size: 12px;
    }
    .run-btn {
      flex-shrink: 0;
      background: var(--t-accent);
      color: var(--t-text-on-accent);
      border: none;
      border-radius: var(--t-radius-sm);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 11px;
      cursor: pointer;
    }
    .run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .run-btn .hint { opacity: 0.7; font-size: 10px; }
  `],
})
export class CommandBarComponent {
  private namespaceService = inject(NamespaceService);
  private panelManager = inject(PanelManagerService);
  private panelExecution = inject(PanelExecutionService);
  private dataModeService = inject(DataModeService);

  protected ns = this.namespaceService.currentNamespace;
  // `top` (metrics) isn't available offline — the snapshot emulator errors on it.
  protected isSnapshot = this.dataModeService.isSnapshotMode;
  customCommand = signal('');

  onExecuteCustomCommand(): void {
    const cmd = this.customCommand().trim();
    if (!cmd) return;
    const panelId = this.panelManager.openGeneralPanel();
    this.panelExecution.execute(panelId, cmd);
  }

  onQuickAction(action: string): void {
    const ns = this.ns();
    let command = '';
    switch (action) {
      case 'get-all':
        command = ns ? `kubectl get all -n '${ns}'` : 'kubectl get all --all-namespaces';
        break;
      case 'events':
        command = ns ? `kubectl get events -n '${ns}' --sort-by=.lastTimestamp` : 'kubectl get events --all-namespaces --sort-by=.lastTimestamp';
        break;
      case 'warnings':
        command = ns
          ? `kubectl get events -n '${ns}' --field-selector type=Warning --sort-by=.lastTimestamp`
          : 'kubectl get events --all-namespaces --field-selector type=Warning --sort-by=.lastTimestamp';
        break;
      case 'nodes':
        command = 'kubectl get nodes -o wide';
        break;
      case 'top-nodes':
        command = 'kubectl top nodes';
        break;
      case 'pods':
        command = ns ? `kubectl get pods -n '${ns}' -o wide` : '';
        break;
      case 'services':
        command = ns ? `kubectl get svc -n '${ns}' -o wide` : '';
        break;
      case 'pvc':
        command = ns ? `kubectl get pvc -n '${ns}'` : '';
        break;
      case 'images':
        command = ns ? `kubectl get pods -n '${ns}' -o custom-columns="POD:.metadata.name,IMAGE:.spec.containers[*].image" --no-headers` : '';
        break;
      case 'top-pods':
        command = ns ? `kubectl top pods -n '${ns}' --sort-by=memory` : '';
        break;
      case 'endpoints':
        command = ns ? `kubectl get endpoints -n '${ns}'` : '';
        break;
    }
    if (!command) return;
    const panelId = this.panelManager.openGeneralPanel();
    this.panelExecution.execute(panelId, command);
  }

  onCommandKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.onExecuteCustomCommand();
    }
  }
}
