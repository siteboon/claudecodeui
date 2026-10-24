import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

import type { IProviderTranscriptRelocation } from '@/shared/interfaces.js';
import type { SessionTranscriptRelocation } from '@/shared/types.js';
import { rewriteJsonlCwd } from '@/shared/utils.js';

/**
 * Keeps Codex sessions with the project they were moved to.
 *
 * Codex rollouts are filed by date, not by directory, and a thread is resumed
 * by id, so the files stay where they are. Only the `cwd` they record changes,
 * on every row whose cwd is the old folder (compared after path normalization). The synchronizer files a
 * session under `session_meta.cwd`, which left stale would move the session
 * back to the old folder on its next pass; `turn_context` rows are rewritten so
 * the rollout agrees with itself.
 *
 * Never throws for one rollout: a project relocation runs this after the
 * Claude facet has already committed its moves, and a throw here would make
 * the caller restore rows that point at files Claude has since removed. A
 * rollout that is missing, unreadable or records no matching cwd is skipped
 * and left out of the result, as the Claude facet does with files it cannot
 * place.
 */
export class CodexTranscriptRelocationProvider implements IProviderTranscriptRelocation {
  async relocateTranscripts(input: {
    sessions: SessionTranscriptRelocation[];
    oldProjectPath: string;
    newProjectPath: string;
  }): Promise<SessionTranscriptRelocation[]> {
    const relocated: SessionTranscriptRelocation[] = [];
    for (const session of input.sessions) {
      // The `.tmp` suffix keeps the session watcher from indexing it.
      const temporaryPath = `${session.jsonlPath}.${randomUUID()}.tmp`;
      try {
        const content = await readFile(session.jsonlPath, 'utf8');
        const rewritten = rewriteJsonlCwd(
          content,
          input.oldProjectPath,
          input.newProjectPath,
          (row) => (row.payload && typeof row.payload === 'object' ? row.payload : null),
        );
        // Nothing named the old folder, so nothing would keep the session there.
        if (rewritten === content) {
          continue;
        }
        await writeFile(temporaryPath, rewritten, { flag: 'wx' });
        // Atomic: a reader sees the old rollout or the rewritten one.
        await rename(temporaryPath, session.jsonlPath);
        relocated.push(session);
      } catch (error) {
        console.warn(`[codex-transcript-relocation] Skipped ${session.jsonlPath}:`, (error as Error).message);
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
    return relocated;
  }
}
