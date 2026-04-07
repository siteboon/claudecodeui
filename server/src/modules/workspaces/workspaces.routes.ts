import express, { type NextFunction, type Request, type Response } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse, createApiSuccessResponse } from '@/shared/http/api-response.js';
import { logger } from '@/shared/utils/logger.js';
import { workspaceService } from '@/modules/workspaces/workspaces.service.js';

const router = express.Router();

const getTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const parseWorkspaceIdFromBody = (req: Request): string => {
  const body = req.body as Record<string, unknown> | undefined;
  const workspaceId = getTrimmedString(body?.workspaceId);
  if (!workspaceId) {
    throw new AppError('workspaceId is required.', {
      code: 'WORKSPACE_ID_REQUIRED',
      statusCode: 400,
    });
  }

  return workspaceId;
};

const parseWorkspaceCustomNameFromBody = (req: Request): string | null => {
  const body = req.body as Record<string, unknown> | undefined;
  const customName = getTrimmedString(body?.workspaceCustomName);
  return customName || null;
};

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const workspaces = workspaceService.listWorkspaces();
    res.json(createApiSuccessResponse({ workspaces }));
  }),
);

router.patch(
  '/star',
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = parseWorkspaceIdFromBody(req);
    const isStarred = workspaceService.toggleWorkspaceStar(workspaceId);
    res.json(createApiSuccessResponse({ workspaceId, isStarred }));
  }),
);

router.patch(
  '/name',
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = parseWorkspaceIdFromBody(req);
    const workspaceCustomName = parseWorkspaceCustomNameFromBody(req);
    workspaceService.updateWorkspaceCustomName(workspaceId, workspaceCustomName);
    res.json(createApiSuccessResponse({ workspaceId, workspaceCustomName }));
  }),
);

router.delete(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = parseWorkspaceIdFromBody(req);
    const result = await workspaceService.deleteWorkspace(workspaceId);
    res.json(createApiSuccessResponse(result));
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

  const message = error instanceof Error ? error.message : 'Unexpected workspaces route failure.';
  logger.error(message, {
    module: 'workspaces.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
