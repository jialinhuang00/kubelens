import { Directive, ElementRef, inject, Input, OnChanges } from '@angular/core';

@Directive({
  selector: '[appTickFlash]',
  standalone: true,
})
export class TickFlashDirective implements OnChanges {
  @Input() tickValue: unknown;

  private el = inject(ElementRef);
  private first = true;

  ngOnChanges() {
    // Skip the initial binding — only flash on subsequent changes
    if (this.first) {
      this.first = false;
      return;
    }

    const element = this.el.nativeElement as HTMLElement;
    element.classList.remove('tick-flash');
    // Force reflow so re-adding the class restarts the animation
    void element.offsetWidth;
    element.classList.add('tick-flash');
  }
}
