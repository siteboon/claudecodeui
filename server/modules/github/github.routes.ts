import express from 'express';

import { AppError } from '@/shared/utils.js';

import type { createGithubService } from './github.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Creates thin GitHub transport handlers around the application service. */
export function createGithubRouter(
  service: ReturnType<typeof createGithubService>,
): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  // POST, not GET: the raw token travels in the body so it never lands in a
  // query string, access log, or browser history.
  router.post('/verify-token', respond((req) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    return service.verifyToken(token);
  }));

  router.get('/repos', respond((req) => {
    const tokenId = Number(req.query.tokenId);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      throw new AppError('tokenId is required', { code: 'GITHUB_TOKEN_ID_REQUIRED', statusCode: 400 });
    }

    const query = queryString(req.query.q);
    const limitInput = Number(req.query.limit);
    const limit = Number.isFinite(limitInput) && limitInput > 0 ? limitInput : undefined;

    return service.searchRepositories(userId(req), tokenId, query, limit);
  }));

  return router;
}
