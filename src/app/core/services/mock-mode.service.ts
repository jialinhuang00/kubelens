import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MockModeService {
  private http = inject(HttpClient);

  isMockMode = signal(true);
  mockAvailable = signal(false);

  async checkAvailability(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ available: boolean }>('http://localhost:3000/api/mock-status')
      );
      this.mockAvailable.set(res.available);
      // Auto-enable mock mode when available
      if (res.available && this.isMockMode()) {
        this.isMockMode.set(true);
      }
    } catch {
      this.mockAvailable.set(false);
      this.isMockMode.set(false);
    }
  }

  toggle(): void {
    if (this.mockAvailable()) {
      this.isMockMode.update(v => !v);
    }
  }

  setMockMode(enabled: boolean): void {
    if (enabled && !this.mockAvailable()) return;
    this.isMockMode.set(enabled);
  }
}
