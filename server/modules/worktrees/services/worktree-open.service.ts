import path from 'node:path';

import type {
  GitCommandRunner,
  OpenWorktreeInput,
  ProjectRepositoryRow,
  WorktreeProjectGateway,
  WorktreeProjectView,
} from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';
import {
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
} from '@/modules/worktrees/services/worktree-git.service.js';

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
  dependencies: {
    runGit: GitCommandRunner;
    projects: Pick<
      WorktreeProjectGateway,
      'getProjectByPath' | 'createProject' | 'restoreProject'
    >;
  },
): Promise<WorktreeProjectView> {
  const { projects, runGit } = dependencies;
  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const entry = findWorktreeEntryByPath(entries, input.worktreePath);

  const normalizedWorktreePath = normalizeProjectPath(entry.path);
  const repoName = path.basename(entries[0].path);
  // "repo · branch" keeps worktree projects visually grouped next to their
  // parent repository in the sidebar.
  const displayName = entry.branch ? `${repoName} · ${entry.branch}` : repoName;

  const existingRow = projects.getProjectByPath(normalizedWorktreePath);
  if (existingRow) {
    if (existingRow.isArchived) {
      await projects.restoreProject(existingRow.project_id);
    }
    const refreshedRow = projects.getProjectByPath(normalizedWorktreePath) ?? existingRow;
    return mapRowToProjectView(refreshedRow);
  }

  const created = await projects.createProject({
    projectPath: normalizedWorktreePath,
    customName: displayName,
  });

  // `createProject` intentionally keeps reactivated archived rows archived;
  // an opened worktree must be active so it shows up in the sidebar.
  if (created.outcome === 'reactivated_archived') {
    await projects.restoreProject(created.project.projectId);
  }

  const row = projects.getProjectByPath(normalizedWorktreePath);
  if (!row) {
    throw new AppError('Failed to resolve project for worktree', {
      code: 'WORKTREE_PROJECT_RESOLVE_FAILED',
      statusCode: 500,
    });
  }

  return mapRowToProjectView(row);
}
