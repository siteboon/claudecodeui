import express from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import { buildUsageReport } from '@/modules/usage/usage.service.js';

/** Read-only usage API (`GET /api/usage/daily`). Scans local logs only; makes no network calls. */
export function createUsageRouter(): express.Router {
  const router = express.Router();
  router.get('/daily', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await buildUsageReport()));
  }));
  return router;
}
