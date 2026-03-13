import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import type { RequestContext } from '@/shared/types/http.js';

type RequestWithContext = Request & {
  context?: RequestContext;
};

export function getRequestContext(req: Request): RequestContext | undefined {
  return (req as RequestWithContext).context;
}

// give every request a context with a unique ID and timestamp for tracking purposes
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const startedAt = new Date().toISOString();
  const context: RequestContext = {
    requestId,
    startedAt,
  };

  (req as RequestWithContext).context = context;
  (res.locals as Record<string, unknown>).requestId = requestId;

  next();
}
