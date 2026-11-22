import { sessionsDb } from '@/modules/database/index.js';
import {
  listTranscriptFiles,
  readTranscript,
} from '@/modules/providers/list/antigravity/antigravity-store.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import { normalizeSessionName, readFileTimestamps } from '@/shared/utils.js';

const PROVIDER = 'antigravity';
const FALLBACK_PROJECT = process.env.AGY_DEFAULT_PROJECT || process.cwd();

/**
 * Indexes this provider's own JSONL transcripts into the sessions table.
 *
 * agy's native conversation store is a protobuf SQLite database, so the
 * transcript written by the runtime is what the sidebar lists. Each file
 * carries a `meta` header with the workspace and title, which is all the
 * session row needs.
 */
export class AntigravitySessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(since?: Date): Promise<number> {
    const files = await listTranscriptFiles();
    let processed = 0;

    for (const { sessionId, filePath } of files) {
      if (since) {
        const timestamps = await readFileTimestamps(filePath);
        if (timestamps.updatedAt && new Date(timestamps.updatedAt).getTime() < since.getTime()) {
          continue;
        }
      }
      const indexed = await this.indexOne(sessionId, filePath);
      if (indexed) {
        processed += 1;
      }
    }

    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    const sessionId = filePath.split(/[\\/]/).pop()!.slice(0, -'.jsonl'.length);
    return this.indexOne(sessionId, filePath);
  }

  private async indexOne(sessionId: string, filePath: string): Promise<string | null> {
    const { meta } = await readTranscript(sessionId);
    const timestamps = await readFileTimestamps(filePath);

    return sessionsDb.createSession(
      sessionId,
      PROVIDER,
      meta?.projectPath || FALLBACK_PROJECT,
      normalizeSessionName(meta?.title ?? undefined, 'Untitled Antigravity Session'),
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }
}
