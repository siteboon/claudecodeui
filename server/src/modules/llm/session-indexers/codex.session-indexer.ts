import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/modules/llm/session-indexers/session-indexer.utils.js';
import type { ISessionIndexer } from '@/modules/llm/session-indexers/session-indexer.interface.js';

type ParsedSession = {
  sessionId: string;
  workspacePath: string;
  sessionName?: string;
};

/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionIndexer implements ISessionIndexer {
  readonly provider = 'codex' as const;

  /**
   * Scans ~/.codex sessions and upserts discovered sessions into DB.
   */
  async synchronize(lastScanAt: Date | null): Promise<number> {
    const codexHome = path.join(os.homedir(), '.codex');
    const nameMap = await buildLookupMap(path.join(codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(codexHome, 'sessions'),
      '.jsonl',
      lastScanAt,
    );

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.workspacePath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>,
  ): Promise<ParsedSession | null> {
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
      const workspacePath = typeof payload?.cwd === 'string' ? payload.cwd : undefined;

      if (!sessionId || !workspacePath) {
        return null;
      }

      return {
        sessionId,
        workspacePath,
        sessionName: normalizeSessionName(nameMap.get(sessionId), 'Untitled Codex Session'),
      };
    });
  }
}
