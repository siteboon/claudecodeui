import express from 'express';

import { projectsDb } from '@/modules/database/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { createWorktree } from '@/modules/worktrees/services/worktree-create.service.js';
import { listWorktrees } from '@/modules/worktrees/services/worktree-list.service.js';
import { mergeWorktree } from '@/modules/worktrees/services/worktree-merge.service.js';
import { openWorktreeAsProject } from '@/modules/worktrees/services/worktree-open.service.js';
import { removeWorktree } from '@/modules/worktrees/services/worktree-remove.service.js';

const router = express.Router();

/**
 * Resolves the `project` request parameter (DB projectId — same contract as
 * /api/git) to the project's absolute directory path.
 */
function resolveProjectPath(projectIdValue: unknown): string {
  const projectId = typeof projectIdValue === 'string' ? projectIdValue.trim() : '';
  if (!projectId) {
    throw new AppError('project is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    });
  }

  const projectPath = projectsDb.getProjectPathById(projectId);
  if (!projectPath) {
    throw new AppError(`Unable to resolve project path for "${projectId}"`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  return projectPath;
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

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectPath = resolveProjectPath(req.query.project);
    const result = await listWorktrees({ projectPath });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/create',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const projectPath = resolveProjectPath(body.project);
    const branch = readRequiredString(body.branch, 'branch');
    const baseBranch = typeof body.baseBranch === 'string' ? body.baseBranch : null;

    const created = await createWorktree({ projectPath, branch, baseBranch });
    // Register the worktree as a project immediately so it is switchable in
    // one round-trip; the client decides whether to actually select it.
    const project = await openWorktreeAsProject({
      projectPath,
      worktreePath: created.worktreePath,
    });

    res.json(createApiSuccessResponse({ ...created, project }));
  }),
);

router.post(
  '/open',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const projectPath = resolveProjectPath(body.project);
    const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

    const project = await openWorktreeAsProject({ projectPath, worktreePath });
    res.json(createApiSuccessResponse({ project }));
  }),
);

router.post(
  '/merge',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const projectPath = resolveProjectPath(body.project);
    const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

    const result = await mergeWorktree({
      projectPath,
      worktreePath,
      squash: Boolean(body.squash),
      message: typeof body.message === 'string' ? body.message : null,
      removeAfterMerge: Boolean(body.removeAfterMerge),
    });

    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/remove',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const projectPath = resolveProjectPath(body.project);
    const worktreePath = readRequiredString(body.worktreePath, 'worktreePath');

    const result = await removeWorktree({
      projectPath,
      worktreePath,
      force: Boolean(body.force),
      deleteBranch: Boolean(body.deleteBranch),
    });

    res.json(createApiSuccessResponse(result));
  }),
);

export default router;
