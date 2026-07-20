import express from 'express';

import type { WorktreeServices } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Parses the project identifier shared by all Worktrees routes.
 *
 * Path resolution intentionally remains in the injected application service so
 * this transport layer never reaches into the Database module.
 */
function readProjectId(projectIdValue: unknown): string {
  const projectId = typeof projectIdValue === 'string' ? projectIdValue.trim() : '';
  if (!projectId) {
    throw new AppError('project is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    });
  }

  return projectId;
}

function readRequiredString(value: unknown, name: string): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) {
    throw new AppError(`${name} is required`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return parsed;
}

/**
 * Builds the Worktrees HTTP router around an injected application-service API.
 *
 * Keeping construction explicit lets route tests supply deterministic services
 * and ensures parsing remains the route layer's only responsibility.
 */
export function createWorktreesRouter(services: WorktreeServices): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const projectPath = services.resolveProjectPath(readProjectId(req.query.project));
      const result = await services.list({ projectPath });
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/create',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const projectPath = services.resolveProjectPath(readProjectId(body.project));
      const branch = readRequiredString(body.branch, 'branch');
      const baseBranch = typeof body.baseBranch === 'string' ? body.baseBranch : null;

      const result = await services.createAndOpen({ projectPath, branch, baseBranch });
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/open',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const projectPath = services.resolveProjectPath(readProjectId(body.project));
      const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

      const project = await services.open({ projectPath, worktreePath });
      res.json(createApiSuccessResponse({ project }));
    }),
  );

  router.post(
    '/merge',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const projectPath = services.resolveProjectPath(readProjectId(body.project));
      const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

      const result = await services.merge({
        projectPath,
        worktreePath,
        squash: typeof body.squash === 'boolean' ? body.squash : false,
        message: typeof body.message === 'string' ? body.message : null,
        removeAfterMerge: typeof body.removeAfterMerge === 'boolean' ? body.removeAfterMerge : false,
      });

      res.json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/remove',
    asyncHandler(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const projectPath = services.resolveProjectPath(readProjectId(body.project));
      const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

      const result = await services.remove({
        projectPath,
        worktreePath,
        force: typeof body.force === 'boolean' ? body.force : false,
        deleteBranch: typeof body.deleteBranch === 'boolean' ? body.deleteBranch : false,
      });

      res.json(createApiSuccessResponse(result));
    }),
  );

  return router;
}
