import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { DataModeService } from '../services/data-mode.service';

export const snapshotInterceptor: HttpInterceptorFn = (req, next) => {
  const dataMode = inject(DataModeService);

  if (dataMode.isSnapshotMode() && req.url.includes('/api/')) {
    const cloned = req.clone({
      params: req.params.set('snapshot', 'true')
    });
    return next(cloned);
  }

  return next(req);
};
