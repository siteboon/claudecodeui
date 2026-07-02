import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

// Resolved lazily (not memoized at module load) so it always reflects the current home directory.
function claudeProjectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function uniqueJsonlPathsFromSessions(
  sessions: Array<{ jsonl_path: string | null }>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of sessions) {
    const raw = row.jsonl_path?.trim();
    if (!raw) {
      continue;
    }
    const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(raw);
    if (seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    result.push(absolute);
  }

  return result;
}

async function unlinkJsonlIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    console.warn(`[project-delete] Failed to remove ${filePath}:`, (error as Error).message);
  }
}

/**
 * Loads all session rows for the project path and removes each distinct `jsonl_path` file on disk.
 */
export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessions = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath);
  const paths = uniqueJsonlPathsFromSessions(sessions);

  for (const filePath of paths) {
    await unlinkJsonlIfExists(filePath);
  }
}

/**
 * Resolves the Claude transcript directory for a project path.
 *
 * Claude stores session files under `~/.claude/projects/<encoded-cwd>/`, where the
 * encoding replaces every character that is not `[a-zA-Z0-9-]` with `-` (mirrors the
 * conventional lookup in `server/index.js`). Returns `null` when the resolved path would
 * escape the Claude projects root, so a malformed `project_path` can never delete outside it.
 */
function resolveClaudeProjectDir(projectPath: string): string | null {
  const root = claudeProjectsRoot();
  const encoded = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(root, encoded);
  const relative = path.relative(root, projectDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return projectDir;
}

/**
 * Removes the entire Claude transcript directory for a project path.
 *
 * `deleteSessionJsonlFilesForProjectPath` only removes files recorded in `sessions.jsonl_path`,
 * so app-created sessions (whose `jsonl_path` is `NULL` until the synchronizer indexes them)
 * leave their transcript on disk. The next `synchronizeSessions()` re-discovers that file and
 * recreates the project, so a "delete all data" request appears to do nothing after a reload.
 * Removing the directory fulfils the documented behaviour and stops the resurrection.
 *
 * Errors are intentionally NOT swallowed: `fs.rm` with `force: true` already ignores a missing
 * directory, so anything it still throws (e.g. a permission error) means transcripts survived on
 * disk. Propagating it aborts `deleteOrArchiveProject` before the DB rows are removed, so the
 * caller sees a failure instead of a "deleted" project that resurrects on the next reload.
 */
async function deleteClaudeProjectDir(projectPath: string): Promise<void> {
  const projectDir = resolveClaudeProjectDir(projectPath);
  if (!projectDir) {
    console.warn('[project-delete] Refusing to remove out-of-root Claude dir');
    return;
  }

  await fs.rm(projectDir, { recursive: true, force: true });
}

/**
 * - **Soft delete** (`force` false): set `isArchived` on the `projects` row (hide from the active list; DB only).
 * - **Force** (`force` true): delete each session row's `jsonl_path` file (when set), remove the whole Claude
 *   transcript directory for the path (covers app-created sessions whose `jsonl_path` is still `NULL`), then
 *   remove the session rows and the `projects` row. Removing the on-disk transcripts is what stops the
 *   synchronizer from recreating ("resurrecting") the project on the next project-list load.
 */
export async function deleteOrArchiveProject(projectId: string, force: boolean): Promise<void> {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!force) {
    projectsDb.updateProjectIsArchivedById(projectId, true);
    return;
  }

  await deleteSessionJsonlFilesForProjectPath(row.project_path);
  await deleteClaudeProjectDir(row.project_path);
  sessionsDb.deleteSessionsByProjectPath(row.project_path);
  projectsDb.deleteProjectById(projectId);
}

/**
 * Restores one archived project row back into the active project list.
 */
export function restoreArchivedProject(projectId: string): void {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  projectsDb.updateProjectIsArchivedById(projectId, false);
}
