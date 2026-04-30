import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * Returns directory entries or an empty list when the folder is missing.
 */
async function listDirectoryEntriesSafe(
  directoryPath: string
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Session indexer for Cursor transcript artifacts.
 */
export class CursorSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'cursor' as const;
  private readonly cursorHome = path.join(os.homedir(), '.cursor');

  /**
   * Scans Cursor chats and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const projectsDir = path.join(this.cursorHome, 'projects');
    const projectEntries = await listDirectoryEntriesSafe(projectsDir);
    const seenProjectPaths = new Set<string>();

    let processed = 0;
    for (const entry of projectEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workerLogPath = path.join(projectsDir, entry.name, 'worker.log');
      const projectPath = await this.extractProjectPathFromWorkerLog(workerLogPath);
      if (!projectPath || seenProjectPaths.has(projectPath)) {
        continue;
      }

      seenProjectPaths.add(projectPath);
      const projectHash = this.md5(projectPath);
      const chatsDir = path.join(this.cursorHome, 'chats', projectHash);
      const files = await findFilesRecursivelyCreatedAfter(chatsDir, '.jsonl', since ?? null);

      for (const filePath of files) {
        const parsed = await this.processSessionFile(filePath);
        if (!parsed) {
          continue;
        }

        const timestamps = await readFileTimestamps(filePath);
        sessionsDb.createSession(
          parsed.sessionId,
          this.provider,
          parsed.projectPath,
          parsed.sessionName,
          timestamps.createdAt,
          timestamps.updatedAt,
          filePath
        );
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Parses and upserts one Cursor session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  /**
   * Produces the same project hash Cursor uses in chat directory names.
   */
  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Extracts project path from Cursor worker.log.
   */
  private async extractProjectPathFromWorkerLog(filePath: string): Promise<string | null> {
    try {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of lineReader) {
        const match = line.match(/workspacePath=(.*)$/);
        const projectPath = match?.[1]?.trim();
        if (projectPath) {
          lineReader.close();
          fileStream.close();
          return projectPath;
        }
      }
    } catch {
      // Missing worker logs are valid for partial or incomplete session data.
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
    const projectPath = await this.extractProjectPathFromWorkerLog(workerLogPath);

    if (!projectPath) {
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
        projectPath,
        sessionName: normalizeSessionName(firstLine, 'Untitled Cursor Session'),
      };
    });
  }
}
