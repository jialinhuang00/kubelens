import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MockModeService } from '../services/mock-mode.service';

export const mockModeInterceptor: HttpInterceptorFn = (req, next) => {
  const mockMode = inject(MockModeService);

  if (mockMode.isMockMode() && req.url.includes('/api/')) {
    const cloned = req.clone({
      params: req.params.set('mock', 'true')
    });
    return next(cloned);
  }

  return next(req);
};
