import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-raw-output',
  imports: [CommonModule],
  templateUrl: './raw-output.component.html',
  styleUrl: './raw-output.component.scss'
})
export class RawOutputComponent {
  @Input() commandOutput: string = '';
}