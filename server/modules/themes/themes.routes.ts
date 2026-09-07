import express from 'express';

import type { createThemeGalleryService } from './themes.service.js';

/** Creates the thin theme-gallery transport handler around the download service. */
export function createThemeGalleryRouter(
  service: ReturnType<typeof createThemeGalleryService>,
): express.Router {
  const router = express.Router();

  // Responds with the raw archive rather than parsed colours: the browser owns
  // the mapping from a VS Code theme to this app's palette, and reusing it for
  // both the file picker and a URL keeps one implementation of it.
  router.post('/download', async (req, res, next) => {
    try {
      const body = req.body as { url?: unknown };
      const { data, fileName } = await service.downloadExtension(body?.url);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.send(data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
