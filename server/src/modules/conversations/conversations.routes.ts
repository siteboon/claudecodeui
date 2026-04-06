import express, { type NextFunction, type Request, type Response } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse, createApiSuccessResponse } from '@/shared/http/api-response.js';
import { logger } from '@/shared/utils/logger.js';
import { conversationSearchService } from '@/modules/conversations/conversation-search.service.js';

const router = express.Router();

router.get(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const provider =
      typeof req.query.provider === 'string' ? req.query.provider.trim().toLowerCase() : undefined;
    const caseSensitive = req.query.caseSensitive === 'true';
    const limit =
      typeof req.query.limit === 'string' && Number.isFinite(Number.parseInt(req.query.limit, 10))
        ? Number.parseInt(req.query.limit, 10)
        : undefined;

    const results = await conversationSearchService.search({
      query,
      provider,
      caseSensitive,
      limit,
    });

    res.json(
      createApiSuccessResponse({
        query,
        provider: provider ?? null,
        count: results.length,
        results,
      }),
    );
  }),
);

/**
 * Normalizes route-level failures to a consistent JSON API shape.
 */
router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof AppError) {
    res
      .status(error.statusCode)
      .json(createApiErrorResponse(error.code, error.message, undefined, error.details));
    return;
  }

  const message =
    error instanceof Error ? error.message : 'Unexpected conversations route failure.';
  logger.error(message, {
    module: 'conversations.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
