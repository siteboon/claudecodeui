import express from 'express';

import type { createThemeGalleryService } from './themes.service.js';

/** Creates the thin theme-gallery transport handlers around the search and download service. */
export function createThemeGalleryRouter(
  service: ReturnType<typeof createThemeGalleryService>,
): express.Router {
  const router = express.Router();

  router.get('/search', async (req, res, next) => {
    try {
      // Express hands a repeated parameter over as an array; only a single value is a query.
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
      res.json({ success: true, data: { extensions: await service.searchThemes(query, sort) } });
    } catch (error) {
      next(error);
    }
  });

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
