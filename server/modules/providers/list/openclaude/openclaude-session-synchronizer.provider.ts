import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedOccSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

export class OpenClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'openclaude' as const;
  private readonly occHome: string;

  constructor(occHome?: string) {
    this.occHome = occHome ?? path.join(os.homedir(), '.config', 'occ');
  }

  async synchronize(since?: Date): Promise<number> {
    const sessionsDir = path.join(this.occHome, 'sessions');
    const files = await findFilesRecursivelyCreatedAfter(sessionsDir, '.jsonl', since ?? null);

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath);
      if (!parsed) continue;

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
      );
      processed += 1;
    }

    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) return null;

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) return null;

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }

  private async processSessionFile(filePath: string): Promise<ParsedOccSession | null> {
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) return null;

      const rawName = typeof data.sessionName === 'string' ? data.sessionName : undefined;
      return {
        sessionId,
        projectPath,
        sessionName: normalizeSessionName(rawName, 'Untitled OCC Session'),
      };
    });
  }
}
