import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
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
 * The transcripts are moved before anything is written, so a failure there
 * leaves the database describing the state that is still on disk.
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

  const movedTranscripts = await sessionsService.relocateProjectTranscripts({
    sessions: transcripts,
    oldProjectPath: previousPath,
    newProjectPath: nextPath,
  });

  projectsDb.updateProjectPathById(projectId, nextPath);
  sessionsDb.updateSessionsProjectPath(previousPath, nextPath);
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
