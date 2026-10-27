import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { SessionTranscriptRelocation } from '@/shared/types.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

// Projects with a relocation under way. A second one would read the same rows,
// and its rollback would put them back over the first one's finished move.
const relocatingProjectIds = new Set<string>();

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
 * the transcripts cannot be moved, or their new paths cannot be saved (the
 * transcripts are then moved back), the rows are put back as they were read,
 * so the database keeps describing what is on disk.
 *
 * Known limitation: only providers with a `transcriptRelocation` facet (Claude
 * today) have their artifacts moved or rewritten. Codex, Cursor and OpenCode
 * record the cwd in their own artifacts, so while their rows move with the
 * project, the next synchronization of such a session (once it is used again,
 * or on a full scan) reads the old cwd back, re-creates the old folder as a
 * project and moves the session there.
 */
export async function relocateProject(
  projectId: string,
  requestedPath: string,
): Promise<RelocateProjectResult> {
  if (relocatingProjectIds.has(projectId)) {
    throw new AppError('This project is already being moved', {
      code: 'PROJECT_RELOCATION_IN_PROGRESS',
      statusCode: 409,
    });
  }
  relocatingProjectIds.add(projectId);
  try {
    return await relocateUnguarded(projectId, requestedPath);
  } finally {
    relocatingProjectIds.delete(projectId);
  }
}

async function relocateUnguarded(
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
  // A run still writing its transcript would lose what it appends during the
  // copy, and then re-create the transcript under the old folder.
  if (sessionRows.some((row) => (
    chatRunRegistry.isProcessing(row.session_id) || providerRuntimeService.hasBackgroundWork(row.session_id)
  ))) {
    throw new AppError('A conversation in this project is still running', {
      code: 'PROJECT_SESSION_RUNNING',
      statusCode: 409,
      details: 'Wait for it to finish or stop it, then try again.',
    });
  }
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
  // instead of inserting a second project that claims the new path.
  projectsDb.updateProjectPathById(projectId, nextPath);

  // Puts the rows back as they were read, including any `jsonl_path` the
  // watcher pointed at a copy that has since been removed.
  const restoreRows = () => {
    projectsDb.updateProjectPathById(projectId, previousPath);
    for (const row of sessionRows) {
      if (row.jsonl_path) {
        sessionsDb.updateSessionTranscriptPath(row.session_id, row.jsonl_path);
      }
    }
  };

  let movedTranscripts: SessionTranscriptRelocation[];
  try {
    movedTranscripts = await sessionsService.relocateProjectTranscripts({
      sessions: transcripts,
      oldProjectPath: previousPath,
      newProjectPath: nextPath,
    });
  } catch (error) {
    // The providers undid their file changes, so the rows go back to what is
    // on disk.
    restoreRows();
    throw error;
  }

  try {
    for (const transcript of movedTranscripts) {
      sessionsDb.updateSessionTranscriptPath(transcript.sessionId, transcript.jsonlPath);
    }
  } catch (error) {
    // The files already moved, so they go back first, by the same relocation
    // with the paths swapped. If that fails too, the providers undid it and the
    // files stay in the new folder, so the project row stays there with them.
    const providerBySession = new Map(transcripts.map((transcript) => [transcript.sessionId, transcript.provider]));
    try {
      await sessionsService.relocateProjectTranscripts({
        sessions: movedTranscripts.map((transcript) => ({
          ...transcript,
          provider: providerBySession.get(transcript.sessionId) ?? '',
        })),
        oldProjectPath: nextPath,
        newProjectPath: previousPath,
      });
    } catch (moveBackError) {
      console.error(
        '[projects] Could not move the transcripts back after a failed relocation:',
        moveBackError instanceof Error ? moveBackError.message : moveBackError,
      );
      throw error;
    }
    restoreRows();
    throw error;
  }

  return {
    projectId,
    path: nextPath,
    previousPath,
    movedSessionCount: sessionRows.length,
    movedTranscriptCount: movedTranscripts.length,
  };
}
