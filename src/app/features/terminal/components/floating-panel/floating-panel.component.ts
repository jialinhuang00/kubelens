import { Component, input, output, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDrag, CdkDragHandle, CdkDragEnd } from '@angular/cdk/drag-drop';
import { PanelState } from '../../models/panel.models';
import { PanelManagerService } from '../../services/panel-manager.service';
import { PanelExecutionService } from '../../services/panel-execution.service';
import { UiStateService } from '../../../dashboard/services/ui-state.service';
import { OutputDisplayComponent } from '../../../dashboard/components/output-display/output-display.component';
import { CommandTemplate } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-floating-panel',
  standalone: true,
  imports: [CommonModule, CdkDrag, CdkDragHandle, OutputDisplayComponent],
  providers: [UiStateService],
  templateUrl: './floating-panel.component.html',
  styleUrl: './floating-panel.component.scss',
})
export class FloatingPanelComponent {
  panel = input.required<PanelState>();
  closeRequest = output<string>();

  private panelManager = inject(PanelManagerService);
  private panelExecution = inject(PanelExecutionService);

  panelTitle = computed(() => {
    const p = this.panel();
    if (p.type === 'general') return 'Command Output';
    return `${p.resourceKind}: ${p.resourceName}`;
  });

  panelStyle = computed(() => {
    const p = this.panel();
    if (p.isMaximized) {
      return {
        position: 'absolute' as const,
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: p.zIndex,
      };
    }
    return {
      position: 'absolute' as const,
      left: `${p.position.x}px`,
      top: `${p.position.y}px`,
      width: `${p.size.width}px`,
      height: `${p.size.height}px`,
      zIndex: p.zIndex,
    };
  });

  onMouseDown(): void {
    this.panelManager.bringToFront(this.panel().id);
  }

  onDragEnded(event: CdkDragEnd): void {
    const p = this.panel();
    const el = event.source.element.nativeElement;
    const transform = el.style.transform;

    const match = transform.match(/translate3d\((-?\d+)px,\s*(-?\d+)px/);
    if (match) {
      const dx = parseInt(match[1], 10);
      const dy = parseInt(match[2], 10);
      this.panelManager.updatePosition(p.id, {
        x: p.position.x + dx,
        y: p.position.y + dy,
      });
      event.source.reset();
    }
  }

  onDoubleClickHeader(): void {
    this.panelManager.toggleMaximize(this.panel().id);
  }

  onClose(): void {
    const p = this.panel();
    if (p.streamStop) {
      p.streamStop();
    }
    this.closeRequest.emit(p.id);
  }

  onStop(): void {
    this.panelExecution.stopStream(this.panel().id);
  }

  onExecuteTemplate(template: CommandTemplate): void {
    const p = this.panel();
    const command = this.panelExecution.substituteCommand(
      template.command,
      p.namespace,
      p.resourceName,
    );
    this.panelExecution.execute(p.id, command);
  }
}
