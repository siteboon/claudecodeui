import path from 'node:path';
import { mkdir, rename, stat } from 'node:fs/promises';

import type { ClaudeTranscriptRelocation } from '@/shared/types.js';

/**
 * Longest encoded folder name the Claude SDK writes verbatim. Past it the SDK
 * truncates and appends a hash of the original path, which this module cannot
 * reproduce, so those projects are left alone instead of guessed at.
 */
const CLAUDE_PROJECT_DIR_MAX_LENGTH = 200;

/**
 * Claude keeps a session transcript at
 * `<claude-config>/projects/<encoded-cwd>/<session-id>.jsonl` and finds it again
 * by re-encoding the cwd it is resumed with, so a transcript left in the old
 * folder is invisible to a resume from the renamed one.
 */
function encodeClaudeProjectDirName(projectPath: string): string | null {
  const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
  return encoded.length > CLAUDE_PROJECT_DIR_MAX_LENGTH ? null : encoded;
}

async function moveTranscriptFile(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    // Something already occupies the destination; overwriting it would destroy
    // a transcript that the new folder legitimately owns.
    return false;
  } catch {
    // Expected: nothing there yet.
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  return true;
}

/**
 * Moves the Claude transcripts of a relocated project folder into the
 * transcript directory the Claude SDK will look in once the project runs from
 * its new path, and reports the rows whose `jsonl_path` must be updated.
 *
 * Used by the Projects module when a project is repointed at a renamed folder:
 * without the move, history still reads from the old file but resuming the
 * conversation fails, because the SDK derives the transcript folder from the
 * cwd it is given.
 *
 * Every transcript is verified to sit in the folder the old project path
 * encodes to before it is touched, so a Claude release that changes the
 * encoding degrades to "leave the files where they are" instead of scattering
 * them. On failure the already-moved files are put back and the error is
 * rethrown, so the caller never writes rows for a half-finished move.
 */
export async function relocateClaudeTranscripts(input: {
  sessions: ClaudeTranscriptRelocation[];
  oldProjectPath: string;
  newProjectPath: string;
}): Promise<ClaudeTranscriptRelocation[]> {
  const encodedOldDirName = encodeClaudeProjectDirName(input.oldProjectPath);
  const encodedNewDirName = encodeClaudeProjectDirName(input.newProjectPath);
  if (!encodedOldDirName || !encodedNewDirName) {
    return [];
  }

  const moved: ClaudeTranscriptRelocation[] = [];
  const undo: ClaudeTranscriptRelocation[] = [];

  try {
    for (const session of input.sessions) {
      const currentDirectory = path.dirname(session.jsonlPath);
      if (path.basename(currentDirectory) !== encodedOldDirName) {
        continue;
      }

      const targetPath = path.join(
        path.dirname(currentDirectory),
        encodedNewDirName,
        path.basename(session.jsonlPath),
      );
      if (targetPath === session.jsonlPath) {
        continue;
      }

      if (await moveTranscriptFile(session.jsonlPath, targetPath)) {
        moved.push({ sessionId: session.sessionId, jsonlPath: targetPath });
        undo.push(session);
      }
    }
  } catch (error) {
    for (const [index, original] of undo.entries()) {
      try {
        await rename(moved[index].jsonlPath, original.jsonlPath);
      } catch (undoError) {
        console.warn(
          `[claude-transcript-relocation] Failed to restore ${original.jsonlPath}:`,
          (undoError as Error).message,
        );
      }
    }
    throw error;
  }

  return moved;
}
