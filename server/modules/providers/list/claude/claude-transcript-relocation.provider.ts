import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

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

/**
 * Rewrites the `cwd` every transcript row records, which is where the session
 * synchronizer reads a session's project path from. Left stale, the next
 * synchronization pass would re-register the old folder as a project and drag
 * the session back to it.
 *
 * Only rows that actually name the old folder are re-serialized; every other
 * line is copied through byte for byte, so nothing else in the user's
 * transcript is rewritten.
 */
function rewriteTranscriptCwd(content: string, oldProjectPath: string, newProjectPath: string): string {
  return content
    .split('\n')
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        return line;
      }

      if (
        typeof row !== 'object'
        || row === null
        || (row as { cwd?: unknown }).cwd !== oldProjectPath
      ) {
        return line;
      }

      return JSON.stringify({ ...(row as Record<string, unknown>), cwd: newProjectPath });
    })
    .join('\n');
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
 * them. Copies are written before any original is removed, and a failure
 * removes the copies again, so the caller never writes rows for a half-finished
 * move.
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
  const sourcePaths: string[] = [];

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

      const content = await readFile(session.jsonlPath, 'utf8');
      await mkdir(path.dirname(targetPath), { recursive: true });
      // `wx` rather than an overwrite: anything already at the destination is a
      // transcript the new folder legitimately owns.
      await writeFile(
        targetPath,
        rewriteTranscriptCwd(content, input.oldProjectPath, input.newProjectPath),
        { flag: 'wx' },
      );

      moved.push({ sessionId: session.sessionId, jsonlPath: targetPath });
      sourcePaths.push(session.jsonlPath);
    }
  } catch (error) {
    for (const relocation of moved) {
      try {
        await unlink(relocation.jsonlPath);
      } catch (cleanupError) {
        console.warn(
          `[claude-transcript-relocation] Failed to remove ${relocation.jsonlPath}:`,
          (cleanupError as Error).message,
        );
      }
    }
    throw error;
  }

  // Only once every copy exists: a transcript that failed to copy must still be
  // readable where the database says it is.
  for (const sourcePath of sourcePaths) {
    try {
      await unlink(sourcePath);
    } catch (error) {
      console.warn(
        `[claude-transcript-relocation] Failed to remove ${sourcePath}:`,
        (error as Error).message,
      );
    }
  }

  return moved;
}
