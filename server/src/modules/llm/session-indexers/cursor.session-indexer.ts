import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  listDirectoryEntriesSafe,
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
 * Session indexer for Cursor transcript artifacts.
 */
export class CursorSessionIndexer implements ISessionIndexer {
  readonly provider = 'cursor' as const;

  /**
   * Scans Cursor chats and upserts discovered sessions into DB.
   */
  async synchronize(lastScanAt: Date | null): Promise<number> {
    const cursorHome = path.join(os.homedir(), '.cursor');
    const projectsDir = path.join(cursorHome, 'projects');
    const projectEntries = await listDirectoryEntriesSafe(projectsDir);
    const seenWorkspacePaths = new Set<string>();

    let processed = 0;
    for (const entry of projectEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workerLogPath = path.join(projectsDir, entry.name, 'worker.log');
      const workspacePath = await this.extractWorkspacePathFromWorkerLog(workerLogPath);
      if (!workspacePath || seenWorkspacePaths.has(workspacePath)) {
        continue;
      }

      seenWorkspacePaths.add(workspacePath);
      const workspaceHash = this.md5(workspacePath);
      const chatsDir = path.join(cursorHome, 'chats', workspaceHash);
      const files = await findFilesRecursivelyCreatedAfter(chatsDir, '.jsonl', lastScanAt);

      for (const filePath of files) {
        const parsed = await this.processSessionFile(filePath);
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
    }

    return processed;
  }

  /**
   * Produces the same workspace hash Cursor uses in chat directory names.
   */
  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Extracts workspace path from Cursor worker.log.
   */
  private async extractWorkspacePathFromWorkerLog(filePath: string): Promise<string | null> {
    try {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of lineReader) {
        const match = line.match(/workspacePath=(.*)$/);
        const workspacePath = match?.[1]?.trim();
        if (workspacePath) {
          lineReader.close();
          fileStream.close();
          return workspacePath;
        }
      }
    } catch {
      // Missing worker logs are valid for partial/incomplete session data.
    }

    return null;
  }

  /**
   * Extracts session metadata from one Cursor JSONL session file.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const sessionId = path.basename(filePath, '.jsonl');
    const grandparentDir = path.dirname(path.dirname(filePath));
    const workerLogPath = path.join(grandparentDir, 'worker.log');
    const workspacePath = await this.extractWorkspacePathFromWorkerLog(workerLogPath);

    if (!workspacePath) {
      return null;
    }

    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, any>;
      if (data.role !== 'user') {
        return null;
      }

      const text = typeof data.message?.content?.[0]?.text === 'string' ? data.message.content[0].text : '';
      const firstLine = text.replace(/<\/?user_query>/g, '').trim().split('\n')[0];

      return {
        sessionId,
        workspacePath,
        sessionName: normalizeSessionName(firstLine, 'Untitled Cursor Session'),
      };
    });
  }
}
