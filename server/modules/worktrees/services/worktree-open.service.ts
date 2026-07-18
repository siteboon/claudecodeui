import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { createProject, restoreArchivedProject } from '@/modules/projects/index.js';
import type { GitCommandRunner, ProjectRepositoryRow } from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

import {
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
  runGitCommand,
} from '@/modules/worktrees/services/worktree-git.service.js';

type OpenWorktreeInput = {
  /** Absolute path of the requesting project (any worktree of the repo). */
  projectPath: string;
  /** Absolute path of the worktree to open as a CloudCLI project. */
  worktreePath: string;
};

/**
 * Project payload in the same shape as `POST /api/projects/create-project`, so
 * the frontend can hand it straight to its existing project-selection flow.
 */
export type WorktreeProjectView = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
  sessions: [];
  sessionMeta: { hasMore: false; total: 0 };
};

function mapRowToProjectView(row: ProjectRepositoryRow): WorktreeProjectView {
  return {
    projectId: row.project_id,
    path: row.project_path,
    fullPath: row.project_path,
    displayName: row.custom_project_name || path.basename(row.project_path),
    isStarred: Boolean(row.isStarred),
    sessions: [],
    sessionMeta: { hasMore: false, total: 0 },
  };
}

/**
 * Ensures a CloudCLI project exists (and is active) for a worktree directory
 * and returns it, so the caller can switch the UI into that worktree.
 *
 * The path is only accepted when it is a registered worktree of the repository
 * that contains `projectPath` — this endpoint must never become a generic
 * "create project anywhere" backdoor.
 */
export async function openWorktreeAsProject(
  input: OpenWorktreeInput,
  runGit: GitCommandRunner = runGitCommand,
): Promise<WorktreeProjectView> {
  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const entry = findWorktreeEntryByPath(entries, input.worktreePath);

  const normalizedWorktreePath = normalizeProjectPath(entry.path);
  const repoName = path.basename(entries[0].path);
  // "repo · branch" keeps worktree projects visually grouped next to their
  // parent repository in the sidebar.
  const displayName = entry.branch ? `${repoName} · ${entry.branch}` : repoName;

  const existingRow = projectsDb.getProjectPath(normalizedWorktreePath);
  if (existingRow) {
    if (existingRow.isArchived) {
      restoreArchivedProject(existingRow.project_id);
    }
    const refreshedRow = projectsDb.getProjectPath(normalizedWorktreePath) ?? existingRow;
    return mapRowToProjectView(refreshedRow);
  }

  const created = await createProject({
    projectPath: normalizedWorktreePath,
    customName: displayName,
  });

  // `createProject` intentionally keeps reactivated archived rows archived;
  // an opened worktree must be active so it shows up in the sidebar.
  if (created.outcome === 'reactivated_archived') {
    restoreArchivedProject(created.project.projectId);
  }

  const row = projectsDb.getProjectPath(normalizedWorktreePath);
  if (!row) {
    throw new AppError('Failed to resolve project for worktree', {
      code: 'WORKTREE_PROJECT_RESOLVE_FAILED',
      statusCode: 500,
    });
  }

  return mapRowToProjectView(row);
}
