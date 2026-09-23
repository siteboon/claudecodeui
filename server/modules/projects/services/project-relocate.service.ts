import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { SessionTranscriptRelocation } from '@/shared/types.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

type RelocateProjectResult = {
  projectId: string;
  path: string;
  previousPath: string;
  movedSessionCount: number;
  movedTranscriptCount: number;
};

async function assertDirectoryExists(projectPath: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(projectPath);
  } catch {
    throw new AppError(`Project path not found: ${projectPath}`, {
      code: 'PROJECT_PATH_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!stats.isDirectory()) {
    throw new AppError('Path exists but is not a directory', {
      code: 'PROJECT_PATH_NOT_DIRECTORY',
      statusCode: 400,
    });
  }
}

/**
 * Points an existing project at a different folder and takes its conversations
 * with it.
 *
 * Used by the Projects routes so a folder renamed or moved outside the app can
 * be repaired in place. Re-adding the new folder instead would leave every
 * session attached to a `project_path` that no longer exists, which is what
 * breaks Files, Source Control, the shell and every new run.
 *
 * The project row moves first (its sessions follow through the FK's
 * `ON UPDATE CASCADE`), then the transcripts, then their new `jsonl_path`s. If
 * the transcripts cannot be moved, the rows are put back as they were read, so
 * the database keeps describing what is on disk.
 */
export async function relocateProject(
  projectId: string,
  requestedPath: string,
): Promise<RelocateProjectResult> {
  const projectRow = projectsDb.getProjectById(projectId);
  if (!projectRow) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const previousPath = projectRow.project_path;
  const unchangedResult: RelocateProjectResult = {
    projectId,
    path: previousPath,
    previousPath,
    movedSessionCount: 0,
    movedTranscriptCount: 0,
  };

  // Compared before the path is validated: projects discovered from a CLI cwd
  // are registered without that check, so the stored path can sit outside the
  // workspace root or be non-canonical. Re-sending it must leave the project
  // alone instead of failing or moving it to the resolved path.
  if (normalizeProjectPath(requestedPath || '') === previousPath) {
    return unchangedResult;
  }

  const pathValidation = await validateWorkspacePath(normalizeProjectPath(requestedPath || ''));
  if (!pathValidation.valid || !pathValidation.resolvedPath) {
    throw new AppError('Invalid project path', {
      code: 'INVALID_PROJECT_PATH',
      statusCode: 400,
      details: pathValidation.error ?? 'Path validation failed',
    });
  }

  const nextPath = normalizeProjectPath(pathValidation.resolvedPath);
  if (nextPath === previousPath) {
    return unchangedResult;
  }

  await assertDirectoryExists(nextPath);

  const occupyingProject = projectsDb.getProjectPath(nextPath);
  if (occupyingProject && occupyingProject.project_id !== projectId) {
    throw new AppError('Another project already uses that path', {
      code: 'PROJECT_ALREADY_EXISTS',
      statusCode: 409,
      details: `Project path already exists: ${nextPath}`,
    });
  }

  // Read before writing: once the project row moves, these rows are no longer
  // reachable through the old path.
  const sessionRows = sessionsDb.getSessionsByProjectPathIncludingArchived(previousPath);
  const transcripts = sessionRows
    .filter((row) => Boolean(row.jsonl_path))
    .map((row) => ({
      sessionId: row.session_id,
      provider: row.provider,
      jsonlPath: path.isAbsolute(row.jsonl_path as string)
        ? path.normalize(row.jsonl_path as string)
        : path.resolve(row.jsonl_path as string),
    }));

  // The row moves before any transcript does. The session watcher may index a
  // relocated transcript, whose cwd already names the new folder, at any point
  // during the move; its `createProjectPath(nextPath)` then lands on this row
  // instead of inserting a second project that this update would collide with.
  projectsDb.updateProjectPathById(projectId, nextPath);

  let movedTranscripts: SessionTranscriptRelocation[];
  try {
    movedTranscripts = await sessionsService.relocateProjectTranscripts({
      sessions: transcripts,
      oldProjectPath: previousPath,
      newProjectPath: nextPath,
    });
  } catch (error) {
    // The providers undid their file changes, so the rows go back to what is
    // on disk, including any `jsonl_path` the watcher pointed at a copy that
    // has since been removed.
    projectsDb.updateProjectPathById(projectId, previousPath);
    for (const row of sessionRows) {
      if (row.jsonl_path) {
        sessionsDb.updateSessionTranscriptPath(row.session_id, row.jsonl_path);
      }
    }
    throw error;
  }

  for (const transcript of movedTranscripts) {
    sessionsDb.updateSessionTranscriptPath(transcript.sessionId, transcript.jsonlPath);
  }

  return {
    projectId,
    path: nextPath,
    previousPath,
    movedSessionCount: sessionRows.length,
    movedTranscriptCount: movedTranscripts.length,
  };
}
