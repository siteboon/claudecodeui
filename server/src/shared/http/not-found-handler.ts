import type { Request, Response } from 'express';

import { createApiErrorResponse, createApiMeta } from './api-response.js';
import { getRequestContext } from './request-context.js';

export function notFoundHandler(req: Request, res: Response): void {
  const context = getRequestContext(req);
  const payload = createApiErrorResponse(
    'NOT_FOUND',
    `Route not found: ${req.originalUrl}`,
    createApiMeta(context?.requestId, context?.startedAt)
  );

  res.status(404).json(payload);
}
