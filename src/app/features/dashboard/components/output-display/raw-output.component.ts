import { Component, Input, ElementRef, ViewChild, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-raw-output',
  imports: [CommonModule],
  templateUrl: './raw-output.component.html',
  styleUrl: './raw-output.component.scss'
})
export class RawOutputComponent implements OnChanges {
  @Input() commandOutput: string = '';
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLDivElement>;

  existingOutput = '';
  newOutput = '';
  private flashTimer: any;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['commandOutput']) {
      const full = this.commandOutput;
      const prev = this.existingOutput + this.newOutput;

      if (full.startsWith(prev)) {
        // Merge previous "new" into existing, set fresh append as new
        this.existingOutput = prev;
        this.newOutput = full.slice(prev.length);
      } else {
        // Full reset (new command)
        this.existingOutput = '';
        this.newOutput = full;
      }

      // After animation, merge new into existing
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => {
        this.existingOutput = this.existingOutput + this.newOutput;
        this.newOutput = '';
      }, 600);

      // Scroll to bottom on next frame
      requestAnimationFrame(() => this.scrollToBottom());
    }
  }

  private scrollToBottom() {
    const el = this.scrollContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
