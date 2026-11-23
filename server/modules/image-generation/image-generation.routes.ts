import express from 'express';

import type { ImageGenerationJob } from '@/shared/index.js';
import { ImageGenerationError } from '@/modules/image-generation/image-generation.error.js';

/** Used by the web composition root and route tests; exposes saved jobs only, never generation. */
export function createImageGenerationRouter(readJob: (projectId: string, jobId: string) => Promise<ImageGenerationJob>) {
  const router = express.Router();
  router.get('/projects/:projectId/jobs/:jobId', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const projectId = request.params.projectId;
      const jobId = request.params.jobId;
      if (!projectId || typeof projectId !== 'string' || typeof jobId !== 'string' || !/^[a-f0-9]{64}$/.test(jobId)) {
        return response.status(400).json({ error: 'Invalid project or image job identifier.' });
      }
      return response.json(await readJob(projectId, jobId));
    } catch (error) {
      const code = error instanceof ImageGenerationError ? error.code : 'IMAGE_JOB_UNAVAILABLE';
      const status = ['JOB_NOT_FOUND', 'PROJECT_NOT_FOUND'].includes(code) ? 404 : code === 'INVALID_INPUT' ? 400 : 503;
      return response.status(status).json({ error: 'The saved image job is unavailable.', code });
    }
  });
  return router;
}
