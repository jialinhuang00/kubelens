import { Directive, ElementRef, Input, OnInit } from '@angular/core';

@Directive({
  selector: '[appCommandDisplay]',
  standalone: true
})
export class CommandDisplayDirective implements OnInit {
  @Input() appCommandDisplay!: string;
  @Input() selectedPod?: string;
  @Input() selectedDeployment?: string;
  @Input() selectedService?: string;
  constructor(private el: ElementRef) { }

  ngOnInit() {
    let displayText = this.appCommandDisplay;

    // Replace actual pod name with placeholder
    if (this.selectedPod) {
      displayText = displayText.replace(this.selectedPod, '{...}');
    }

    // Replace actual deployment name with placeholder
    if (this.selectedDeployment) {
      displayText = displayText.replace(this.selectedDeployment, '{...}');
    }

    // Replace actual service name with placeholder
    if (this.selectedService) {
      displayText = displayText.replace(this.selectedService, '{...}');
    }

    this.el.nativeElement.textContent = displayText;
  }
}