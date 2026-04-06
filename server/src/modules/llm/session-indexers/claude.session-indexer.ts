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
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionIndexer implements ISessionIndexer {
  readonly provider = 'claude' as const;

  /**
   * Scans ~/.claude projects and upserts discovered sessions into DB.
   */
  async synchronize(lastScanAt: Date | null): Promise<number> {
    const claudeHome = path.join(os.homedir(), '.claude');
    const nameMap = await buildLookupMap(path.join(claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(claudeHome, 'projects'),
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
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>,
  ): Promise<ParsedSession | null> {
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const workspacePath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !workspacePath) {
        return null;
      }

      return {
        sessionId,
        workspacePath,
        sessionName: normalizeSessionName(nameMap.get(sessionId), 'Untitled Claude Session'),
      };
    });
  }
}
