import express from 'express';

import type { createSystemStorageService } from './system-storage.service.js';
import type { createSystemUpdateService } from './system.service.js';

type SystemRouterServices = {
  systemUpdateService: ReturnType<typeof createSystemUpdateService>;
  systemStorageService: ReturnType<typeof createSystemStorageService>;
};

/** Creates thin system routes that delegate update, storage and backup work to the services. */
export function createSystemRouter({
  systemUpdateService,
  systemStorageService,
}: SystemRouterServices): express.Router {
  const router = express.Router();

  router.post('/update', async (_request, response, next) => {
    try {
      const result = await systemUpdateService.updateSystem();
      response.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/storage', (_request, response, next) => {
    try {
      // The paths include the OS user's home folder: keep them out of shared caches.
      response.setHeader('Cache-Control', 'no-store');
      response.json(systemStorageService.getStorageLocations());
    } catch (error) {
      next(error);
    }
  });

  router.get('/backup', async (_request, response, next) => {
    try {
      const backup = await systemStorageService.createDatabaseBackup();
      response.setHeader('Content-Type', 'application/vnd.sqlite3');
      response.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);
      // A dump of the credential database: never let a browser or proxy keep a copy.
      response.setHeader('Cache-Control', 'no-store');
      response.send(backup.contents);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
