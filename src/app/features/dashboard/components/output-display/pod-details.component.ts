import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PodDescribeData } from '../../../../shared/models/kubectl.models';

@Component({
  selector: 'app-pod-details',
  imports: [CommonModule],
  templateUrl: './pod-details.component.html',
  styleUrl: './pod-details.component.scss'
})
export class PodDetailsComponent {
  @Input() podDescribeData: PodDescribeData[] = [];
  @Input() expandedPods: Set<string> = new Set();

  @Output() togglePodDetails = new EventEmitter<string>();

  onTogglePodDetails(podName: string) {
    this.togglePodDetails.emit(podName);
  }

  isPodExpanded(podName: string): boolean {
    return this.expandedPods.has(podName);
  }
}