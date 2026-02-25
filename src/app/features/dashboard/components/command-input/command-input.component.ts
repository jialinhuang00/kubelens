import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
@Component({
  selector: 'app-command-input',
  imports: [CommonModule, FormsModule],
  templateUrl: './command-input.component.html',
  styleUrl: './command-input.component.scss'
})
export class CommandInputComponent {
  @Input() command!: string;
  @Input() isLoading!: boolean;
  @Input() isStreaming = false;
  @Output() commandChange = new EventEmitter<string>();
  @Output() commandExecute = new EventEmitter<void>();
  @Output() stopStream = new EventEmitter<void>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();

  onCommandChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.commandChange.emit(target.value);
  }

  onKeyDown(event: KeyboardEvent) {
    this.keyDown.emit(event);
  }

  onExecute() {
    this.commandExecute.emit();
  }

  onStop() {
    this.stopStream.emit();
  }
}