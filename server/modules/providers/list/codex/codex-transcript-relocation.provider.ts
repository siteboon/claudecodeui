import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

import type { IProviderTranscriptRelocation } from '@/shared/interfaces.js';
import type { SessionTranscriptRelocation } from '@/shared/types.js';
import { rewriteJsonlCwd } from '@/shared/utils.js';

/**
 * Keeps Codex sessions with the project they were moved to.
 *
 * Codex rollouts are filed by date, not by directory, and a thread is resumed
 * by id, so the files stay where they are. Only the `cwd` they record changes
 * (`session_meta` and every `turn_context`): the synchronizer files a session
 * under that cwd, and left stale it would move the session back to the old
 * folder on its next pass.
 *
 * All or nothing, like the Claude facet: every rewrite is staged beside its
 * rollout first and swapped in only once all of them are written.
 */
export class CodexTranscriptRelocationProvider implements IProviderTranscriptRelocation {
  async relocateTranscripts(input: {
    sessions: SessionTranscriptRelocation[];
    oldProjectPath: string;
    newProjectPath: string;
  }): Promise<SessionTranscriptRelocation[]> {
    const staged: Array<{ temporaryPath: string; session: SessionTranscriptRelocation }> = [];
    try {
      for (const session of input.sessions) {
        const content = await readFile(session.jsonlPath, 'utf8');
        const rewritten = rewriteJsonlCwd(
          content,
          [input.oldProjectPath],
          input.newProjectPath,
          (row) => (row.payload && typeof row.payload === 'object' ? row.payload : null),
        );
        // The `.tmp` suffix keeps the session watcher from indexing it.
        const temporaryPath = `${session.jsonlPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, rewritten, { flag: 'wx' });
        staged.push({ temporaryPath, session });
      }
    } catch (error) {
      await Promise.all(staged.map(({ temporaryPath }) => unlink(temporaryPath).catch(() => undefined)));
      throw error;
    }

    // A rename over the original is atomic: a reader sees the old rollout or
    // the rewritten one, never a half-written file.
    const relocated: SessionTranscriptRelocation[] = [];
    for (const { temporaryPath, session } of staged) {
      try {
        await rename(temporaryPath, session.jsonlPath);
        relocated.push(session);
      } catch (error) {
        console.warn(`[codex-transcript-relocation] Failed to rewrite ${session.jsonlPath}:`, (error as Error).message);
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
    return relocated;
  }
}
