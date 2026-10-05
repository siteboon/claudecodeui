import express from 'express';

import { AppError, createApiSuccessResponse } from '@/shared/utils.js';

import type { createKeepAwakeService } from './keep-awake.service.js';
import type { createSystemUpdateService } from './system.service.js';

/**
 * Creates thin system routes that delegate update execution and keep-awake settings to their services.
 * Used by the system module to mount them, and by the keep-awake route tests with a fake-backed service.
 */
export function createSystemRouter(
  systemUpdateService: ReturnType<typeof createSystemUpdateService>,
  keepAwakeService: ReturnType<typeof createKeepAwakeService>,
): express.Router {
  const router = express.Router();

  router.post('/update', async (_request, response, next) => {
    try {
      const result = await systemUpdateService.updateSystem();
      response.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/keep-awake', (_request, response) => {
    response.json(createApiSuccessResponse(keepAwakeService.getStatus()));
  });

  router.put('/keep-awake', (request, response, next) => {
    try {
      const enabled = (request.body as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled !== 'boolean') {
        throw new AppError('"enabled" must be true or false', {
          code: 'INVALID_KEEP_AWAKE_SETTING',
          statusCode: 400,
        });
      }
      response.json(createApiSuccessResponse(keepAwakeService.setEnabled(enabled)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
