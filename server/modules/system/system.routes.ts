import express from 'express';

import type { createSystemUpdateService } from './system.service.js';

/**
 * Creates thin system routes that delegate update execution to the service.
 * POST starts the update in the background (202); GET reports 202 while it
 * runs and then the final result with the original 200/500 contract.
 */
export function createSystemRouter(
  systemUpdateService: ReturnType<typeof createSystemUpdateService>,
): express.Router {
  const router = express.Router();

  router.post('/update', (_request, response) => {
    systemUpdateService.startUpdate();
    response.status(202).json({ running: true });
  });

  router.get('/update', (_request, response) => {
    const { running, result } = systemUpdateService.getUpdateStatus();
    if (running) {
      response.status(202).json({ running: true });
    } else if (!result) {
      response.status(404).json({ success: false, error: 'No update has been started' });
    } else {
      response.status(result.success ? 200 : 500).json(result);
    }
  });

  return router;
}
