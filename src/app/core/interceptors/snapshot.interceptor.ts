import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { DataModeService } from '../services/data-mode.service';

/**
 * Appends `?snapshot=true` to every `/api/` request when the app is in
 * Snapshot mode. The backend routes use this query param to decide whether
 * to run live kubectl commands or read from local `k8s-snapshot/` files.
 */
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
