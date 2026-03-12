import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import { createApiErrorResponse, createApiMeta } from './api-response.js';
import { getRequestContext } from './request-context.js';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const appError = error instanceof AppError ? error : new AppError(error.message);
  const context = getRequestContext(req);
  const payload = createApiErrorResponse(
    appError.code,
    appError.message,
    createApiMeta(context?.requestId, context?.startedAt),
    appError.details
  );

  logger.error(appError.message, {
    code: appError.code,
    statusCode: appError.statusCode,
    requestId: context?.requestId,
  });

  res.status(appError.statusCode).json(payload);
}
