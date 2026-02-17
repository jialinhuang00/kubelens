import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../../../core/constants/api';

interface EcrTagsResponse {
  tags: string[];
  repository: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EcrService {
  private http = inject(HttpClient);
  private readonly API_BASE = API_BASE;

  tags = signal<string[]>([]);
  isLoading = signal(false);
  error = signal<string>('');
  repository = signal<string>('');

  async fetchTags(image: string): Promise<string[]> {
    this.isLoading.set(true);
    this.error.set('');

    try {
      const response = await firstValueFrom(
        this.http.get<EcrTagsResponse>(`${this.API_BASE}/ecr/tags`, {
          params: { image }
        })
      );

      this.tags.set(response.tags);
      this.repository.set(response.repository);
      if (response.error) {
        this.error.set(response.error);
      }
      return response.tags;
    } catch (err: any) {
      const message = err?.message || 'Failed to fetch ECR tags';
      this.error.set(message);
      this.tags.set([]);
      return [];
    } finally {
      this.isLoading.set(false);
    }
  }

  clear() {
    this.tags.set([]);
    this.isLoading.set(false);
    this.error.set('');
    this.repository.set('');
  }
}
