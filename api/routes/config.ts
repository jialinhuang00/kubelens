import express from 'express';
import type { Request, Response } from 'express';
import { loadResources, loadTemplates } from '../utils/config-loader';

const router = express.Router();

// GET /api/config: resource kinds + per-kind command templates. Frontend reads
// this at startup instead of hardcoding the lists.
router.get('/config', (req: Request, res: Response) => {
  res.json({ resources: loadResources(), templates: loadTemplates() });
});

export = router;
