import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';

import type { IProviderTranscriptRelocation } from '@/shared/interfaces.js';
import type { SessionTranscriptRelocation } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

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
  // The SDK NFC-normalizes the path on macOS before encoding it, and an accent
  // stored decomposed (NFD) would otherwise encode to a different folder name.
  const sdkPath = process.platform === 'darwin' ? projectPath.normalize('NFC') : projectPath;
  const encoded = sdkPath.replace(/[^a-zA-Z0-9]/g, '-');
  return encoded.length > CLAUDE_PROJECT_DIR_MAX_LENGTH ? null : encoded;
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
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
 * Reached through `sessionsService.relocateProjectTranscripts` when the
 * Projects module repoints a project at a renamed folder: without the move,
 * history still reads from the old file but resuming the conversation fails,
 * because the SDK derives the transcript folder from the cwd it is given.
 *
 * Every transcript is verified to sit in the folder the old project path
 * encodes to before it is touched, so a Claude release that changes the
 * encoding degrades to "leave the files where they are" instead of scattering
 * them. Copies are written before any original is removed, and a failure
 * removes the copies again, so the caller can put its rows back and they match
 * the disk.
 *
 * The `<session-id>/` folder beside a transcript (subagent transcripts, tool
 * results, workflow journals) moves with it, and back again on a failure: the
 * history reader looks for it next to the transcript.
 *
 * When both paths encode to the same folder ("my project" -> "my_project"),
 * the transcript is already where a resume looks, but its `cwd` still has to
 * be rewritten; that one is rewritten in place and reported like a move.
 */
export class ClaudeTranscriptRelocationProvider implements IProviderTranscriptRelocation {
  async relocateTranscripts(input: {
    sessions: SessionTranscriptRelocation[];
    oldProjectPath: string;
    newProjectPath: string;
  }): Promise<SessionTranscriptRelocation[]> {
    const encodedOldDirName = encodeClaudeProjectDirName(input.oldProjectPath);
    const encodedNewDirName = encodeClaudeProjectDirName(input.newProjectPath);
    if (!encodedOldDirName || !encodedNewDirName) {
      return [];
    }

    const moved: SessionTranscriptRelocation[] = [];
    // Every file written so far, which a failure removes again.
    const writtenPaths: string[] = [];
    const sourcePaths: string[] = [];
    // Rewritten transcripts waiting to replace an original that stays in place.
    const inPlaceRewrites: Array<{ temporaryPath: string; jsonlPath: string }> = [];
    // Session folders already moved, which a failure moves back.
    const movedDirectories: Array<{ sourcePath: string; targetPath: string }> = [];

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
        const content = await readFile(session.jsonlPath, 'utf8');
        const rewrittenContent = rewriteTranscriptCwd(content, input.oldProjectPath, input.newProjectPath);

        if (targetPath === session.jsonlPath) {
          // Written beside the original and swapped in only after every other
          // transcript is in place, so a failure leaves this one untouched. The
          // `.tmp` suffix keeps the session watcher from indexing it.
          const temporaryPath = `${session.jsonlPath}.${randomUUID()}.tmp`;
          await writeFile(temporaryPath, rewrittenContent, { flag: 'wx' });
          writtenPaths.push(temporaryPath);
          inPlaceRewrites.push({ temporaryPath, jsonlPath: session.jsonlPath });
          moved.push({ sessionId: session.sessionId, jsonlPath: session.jsonlPath });
          continue;
        }

        await mkdir(path.dirname(targetPath), { recursive: true });
        // `wx` rather than an overwrite: anything already at the destination is a
        // transcript the new folder legitimately owns.
        await writeFile(targetPath, rewrittenContent, { flag: 'wx' });
        writtenPaths.push(targetPath);

        // Both folders share a parent, so this is a single atomic rename.
        const sessionDirectoryName = path.basename(session.jsonlPath, '.jsonl');
        const sessionDirectory = path.join(currentDirectory, sessionDirectoryName);
        if (await isDirectory(sessionDirectory)) {
          const targetDirectory = path.join(path.dirname(targetPath), sessionDirectoryName);
          await rename(sessionDirectory, targetDirectory);
          movedDirectories.push({ sourcePath: sessionDirectory, targetPath: targetDirectory });
        }

        moved.push({ sessionId: session.sessionId, jsonlPath: targetPath });
        sourcePaths.push(session.jsonlPath);
      }
    } catch (error) {
      for (const directory of movedDirectories) {
        try {
          await rename(directory.targetPath, directory.sourcePath);
        } catch (cleanupError) {
          console.warn(
            `[claude-transcript-relocation] Failed to move ${directory.targetPath} back:`,
            (cleanupError as Error).message,
          );
        }
      }
      for (const writtenPath of writtenPaths) {
        try {
          await unlink(writtenPath);
        } catch (cleanupError) {
          console.warn(
            `[claude-transcript-relocation] Failed to remove ${writtenPath}:`,
            (cleanupError as Error).message,
          );
        }
      }

      // Something already sits where a transcript or its session folder was
      // headed, typically a copy made by resuming the session from the renamed
      // folder. It is not ours to overwrite, so the user has to decide.
      const fsError = error as NodeJS.ErrnoException & { dest?: string };
      if (fsError.code === 'EEXIST' || fsError.code === 'ENOTEMPTY') {
        throw new AppError('The new folder already holds a copy of one of this project\'s conversations', {
          code: 'TRANSCRIPT_ALREADY_EXISTS',
          statusCode: 409,
          details: `Claude already has ${fsError.dest ?? fsError.path} for the new folder. Move or delete it, then try again.`,
        });
      }
      throw error;
    }

    // A rename over the original is atomic, so a reader sees either the old
    // transcript or the rewritten one, never a half-written file.
    for (const { temporaryPath, jsonlPath } of inPlaceRewrites) {
      try {
        await rename(temporaryPath, jsonlPath);
      } catch (error) {
        console.warn(
          `[claude-transcript-relocation] Failed to rewrite ${jsonlPath}:`,
          (error as Error).message,
        );
        await unlink(temporaryPath).catch(() => undefined);
      }
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
}
