import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ClipboardService {
  async copyToClipboard(text: string, event?: Event): Promise<boolean> {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      
      if (event) {
        this.showCopyFeedback(event.target as HTMLElement);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.fallbackCopy(text);
      return false;
    }
  }

  private fallbackCopy(text: string): void {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
      document.execCommand('copy');
    } catch (error) {
      console.error('Fallback copy failed:', error);
    } finally {
      document.body.removeChild(textArea);
    }
  }

  private showCopyFeedback(element: HTMLElement): void {
    if (!element) return;

    const originalText = element.getAttribute('data-copy-tooltip') || '';
    const feedbackText = 'Copied!';
    
    element.setAttribute('data-copy-tooltip', feedbackText);
    element.classList.add('copy-success');

    setTimeout(() => {
      element.setAttribute('data-copy-tooltip', originalText);
      element.classList.remove('copy-success');
    }, 1500);
  }
}