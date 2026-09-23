import express from 'express';
import type { Request, Response } from 'express';

import { queuedMessagesService } from '@/modules/scheduled-messages/services/queued-messages.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

function readUserId(request: Request): number {
  const userId = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isInteger(userId)) {
    throw new AppError('Authenticated user is required.', { code: 'USER_REQUIRED', statusCode: 401 });
  }
  return userId;
}

function readSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('sessionId is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return value;
}

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse(
      queuedMessagesService.listForSession(readUserId(req), readSessionId(req.query.sessionId)),
    ));
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = queuedMessagesService.enqueue({
      userId: readUserId(req),
      sessionId: readSessionId(body.sessionId),
      content: typeof body.content === 'string' ? body.content : '',
      options: body.options,
      attachments: body.attachments,
    });
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const removed = queuedMessagesService.remove(readUserId(req), String(req.params.id ?? ''));
    res.json(createApiSuccessResponse({ removed }));
  }),
);

export default router;
