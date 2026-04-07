import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { AppError } from '@/shared/utils/app-error.js';
import { createApiErrorResponse, createApiSuccessResponse } from '@/shared/http/api-response.js';
import { llmAssetsService } from '@/modules/assets/assets.service.js';
import { logger } from '@/shared/utils/logger.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024,
  },
});

/**
 * Reads optional query/body values and trims surrounding whitespace.
 */
const readOptionalQueryString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Uploads one or more images into `.cloudcli/assets` so providers can reuse file paths.
 */
router.post(
  '/images',
  upload.array('images', 10),
  asyncHandler(async (req: Request, res: Response) => {
    const workspacePath = readOptionalQueryString((req.body as Record<string, unknown> | undefined)?.workspacePath);
    const filesValue = (req as Request & { files?: unknown }).files;
    const files = Array.isArray(filesValue) ? filesValue as Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }> : [];
    const images = await llmAssetsService.storeUploadedImages(files, { workspacePath });
    res.status(201).json(createApiSuccessResponse({ images }));
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

  const message = error instanceof Error ? error.message : 'Unexpected assets route failure.';
  logger.error(message, {
    module: 'assets.routes',
  });

  res.status(500).json(createApiErrorResponse('INTERNAL_ERROR', message));
});

export default router;
