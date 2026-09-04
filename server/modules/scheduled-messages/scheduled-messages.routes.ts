import express from 'express';
import type { Request, Response } from 'express';

import { scheduledMessagesService } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

function readUserId(request: Request): number {
  const userId = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isInteger(userId)) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return userId;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${field} is required.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return value;
}

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const userId = readUserId(req);
    res.json(createApiSuccessResponse(
      sessionId
        ? scheduledMessagesService.listForSession(userId, sessionId)
        : scheduledMessagesService.listPending(userId),
    ));
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = scheduledMessagesService.schedule({
      userId: readUserId(req),
      sessionId: readString(body.sessionId, 'sessionId'),
      content: readString(body.content, 'content'),
      options: body.options,
      scheduledFor: readString(body.scheduledFor, 'scheduledFor'),
    });
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    scheduledMessagesService.cancel(readUserId(req), readString(req.params.id, 'id'));
    res.json(createApiSuccessResponse({ cancelled: true }));
  }),
);

export default router;
