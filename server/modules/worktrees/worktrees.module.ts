import { access } from 'node:fs/promises';

import { projectsDb } from '@/modules/database/index.js';
import {
  createProject,
  deleteOrArchiveProject,
  restoreArchivedProject,
} from '@/modules/projects/index.js';
import type {
  WorktreeFileSystem,
  WorktreeProjectGateway,
  WorktreeServices,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { createWorktree } from '@/modules/worktrees/services/worktree-create.service.js';
import { createAndOpenWorktree } from '@/modules/worktrees/services/worktree-create-and-open.service.js';
import { runGitCommand } from '@/modules/worktrees/services/worktree-git.service.js';
import { listWorktrees } from '@/modules/worktrees/services/worktree-list.service.js';
import { mergeWorktree } from '@/modules/worktrees/services/worktree-merge.service.js';
import { openWorktreeAsProject } from '@/modules/worktrees/services/worktree-open.service.js';
import { removeWorktree } from '@/modules/worktrees/services/worktree-remove.service.js';
import { createWorktreesRouter } from '@/modules/worktrees/worktrees.routes.js';

/**
 * Real filesystem adapter used only by Worktrees production composition.
 *
 * Services depend on the shared capability type and therefore cannot touch a
 * developer's filesystem unless this adapter is explicitly supplied.
 */
const worktreeFileSystem: WorktreeFileSystem = {
  async pathExists(candidatePath: string): Promise<boolean> {
    try {
      await access(candidatePath);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Projects boundary for Worktrees production workflows.
 *
 * Imports are deliberately restricted to the Database and Projects barrel
 * files. No Worktrees service knows which repository or project service backs
 * these operations.
 */
const worktreeProjects: WorktreeProjectGateway = {
  getProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
  getProjectByPath: (projectPath) => projectsDb.getProjectPath(projectPath),
  createProject: (input) => createProject(input),
  restoreProject: (projectId) => restoreArchivedProject(projectId),
  archiveProject: (projectId) => deleteOrArchiveProject(projectId, false),
};

const remove: WorktreeServices['remove'] = (input) => removeWorktree(input, {
  runGit: runGitCommand,
  projects: worktreeProjects,
});

const create: WorktreeServices['create'] = (input) => createWorktree(input, {
  runGit: runGitCommand,
  fileSystem: worktreeFileSystem,
});

const open: WorktreeServices['open'] = (input) => openWorktreeAsProject(input, {
  runGit: runGitCommand,
  projects: worktreeProjects,
});

/**
 * Production Worktrees application-service surface.
 *
 * This is the module's composition root: it is the only location that combines
 * concrete adapters with the independently testable workflow functions.
 */
const worktreeServices: WorktreeServices = {
  resolveProjectPath(projectId) {
    const projectPath = worktreeProjects.getProjectPathById(projectId);
    if (!projectPath) {
      throw new AppError(`Unable to resolve project path for "${projectId}"`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }

    return projectPath;
  },
  list: (input) => listWorktrees(input, {
    runGit: runGitCommand,
    getProjectByPath: worktreeProjects.getProjectByPath,
  }),
  create,
  createAndOpen: (input) => createAndOpenWorktree(input, {
    createWorktree: create,
    openWorktree: open,
    removeWorktree: remove,
  }),
  open,
  merge: (input) => mergeWorktree(input, {
    runGit: runGitCommand,
    removeWorktree: remove,
  }),
  remove,
};

/**
 * Worktrees router mounted by the server entrypoint at `/api/worktrees`.
 *
 * It is assembled here so other modules consume only the Worktrees barrel and
 * cannot depend on route or service implementation files.
 */
export const worktreesRoutes = createWorktreesRouter(worktreeServices);
