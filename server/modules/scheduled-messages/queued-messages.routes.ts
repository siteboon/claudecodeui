import express from 'express';
import type { Request } from 'express';

import { queuedMessagesService } from '@/modules/scheduled-messages/services/queued-messages.service.js';
import {
  AppError,
  asyncHandler,
  createApiSuccessResponse,
  readObjectRecord,
} from '@/shared/index.js';

function userId(req: Request): number {
  const value = Number(
    (req as Request & { user?: { id?: string | number } }).user?.id,
  );
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return value;
}
const router = express.Router();
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      createApiSuccessResponse(
        queuedMessagesService.list(
          userId(req),
          String(req.query.sessionId ?? ''),
        ),
      ),
    );
  }),
);
router.get(
  '/operations/:id',
  asyncHandler(async (req, res) => {
    res.json(
      createApiSuccessResponse(
        queuedMessagesService.result(userId(req), String(req.params.id)),
      ),
    );
  }),
);
router.post(
  '/',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        createApiSuccessResponse(
          queuedMessagesService.enqueue(
            userId(req),
            readObjectRecord(req.body) ?? {},
          ),
        ),
      );
  }),
);
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(
      createApiSuccessResponse(
        queuedMessagesService.update(
          userId(req),
          String(req.params.id),
          readObjectRecord(req.body) ?? {},
        ),
      ),
    );
  }),
);
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    queuedMessagesService.cancel(
      userId(req),
      String(req.params.id),
      readObjectRecord(req.body)?.revision,
    );
    res.json(createApiSuccessResponse({ cancelled: true }));
  }),
);

/** Mounted by the server composition root for versioned FIFO message operations. */
export default router;
