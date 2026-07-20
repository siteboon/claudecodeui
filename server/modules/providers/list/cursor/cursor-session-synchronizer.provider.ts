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

import {
  extractCursorAgentIds,
  parseCursorSubagentTranscriptPath,
} from './utils/cursor-subagent.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  isSubagent?: boolean;
  parentProviderSessionId?: string | null;
};

/**
 * Returns directory entries or an empty list when the folder is missing.
 */
async function listDirectoryEntriesSafe(
  directoryPath: string,
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

    let processed = 0;

    const files = await findFilesRecursivelyCreatedAfter(projectsDir, '.jsonl', since ?? null);

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
        filePath,
        {
          isSubagent: Boolean(parsed.isSubagent),
          parentSessionId: parsed.parentProviderSessionId ?? null,
        },
      );
      processed += 1;
    }

    // Cursor Task subagents often land as peer agent-transcript folders (not
    // under …/subagents/). Link those via parent store.db agentId references.
    processed += await this.linkSubagentsFromCursorStores();

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
    const sessionId = sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
      {
        isSubagent: Boolean(parsed.isSubagent),
        parentSessionId: parsed.parentProviderSessionId ?? null,
      },
    );

    // A parent transcript update may reveal new Task agentIds.
    if (!parsed.isSubagent) {
      await this.linkSubagentsFromParentStore(parsed.sessionId, parsed.projectPath);
    }

    return sessionId;
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
    const subagentPath = parseCursorSubagentTranscriptPath(filePath);

    // worker.log lives on the project slug directory. For classic subagent
    // paths that is four levels up from the file; for root transcripts, three.
    const projectSlugDir = subagentPath
      ? path.dirname(path.dirname(path.dirname(path.dirname(filePath))))
      : path.dirname(path.dirname(path.dirname(filePath)));
    const workerLogPath = path.join(projectSlugDir, 'worker.log');
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
      // Drop Cursor's `<timestamp>…</timestamp>` prefix and `<user_query>` tags
      // so the session name comes from the actual first line the user typed.
      const firstLine = text
        .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
        .replace(/<\/?user_query>/g, '')
        .trim()
        .split('\n')[0];

      return {
        sessionId,
        projectPath,
        sessionName: normalizeSessionName(firstLine, 'Untitled Cursor Session'),
        isSubagent: Boolean(subagentPath),
        parentProviderSessionId: subagentPath?.parentProviderSessionId ?? null,
      };
    });
  }

  /**
   * Scans Cursor chat store.db files for Task tool agentId references and marks
   * those sessions as hidden subagents of the parent conversation.
   */
  private async linkSubagentsFromCursorStores(): Promise<number> {
    const chatsRoot = path.join(this.cursorHome, 'chats');
    const cwdEntries = await listDirectoryEntriesSafe(chatsRoot);
    let linked = 0;

    for (const cwdEntry of cwdEntries) {
      if (!cwdEntry.isDirectory()) {
        continue;
      }

      const cwdDir = path.join(chatsRoot, cwdEntry.name);
      const sessionEntries = await listDirectoryEntriesSafe(cwdDir);
      for (const sessionEntry of sessionEntries) {
        if (!sessionEntry.isDirectory()) {
          continue;
        }

        const parentProviderSessionId = sessionEntry.name;
        const storeDbPath = path.join(cwdDir, parentProviderSessionId, 'store.db');
        try {
          await fsp.access(storeDbPath);
        } catch {
          continue;
        }

        linked += await this.linkSubagentsFromStoreDb(parentProviderSessionId, storeDbPath);
      }
    }

    return linked;
  }

  private async linkSubagentsFromParentStore(
    parentProviderSessionId: string,
    projectPath: string,
  ): Promise<number> {
    const cwdId = crypto.createHash('md5').update(projectPath || process.cwd()).digest('hex');
    const storeDbPath = path.join(this.cursorHome, 'chats', cwdId, parentProviderSessionId, 'store.db');
    try {
      await fsp.access(storeDbPath);
    } catch {
      return 0;
    }

    return this.linkSubagentsFromStoreDb(parentProviderSessionId, storeDbPath);
  }

  private async linkSubagentsFromStoreDb(
    parentProviderSessionId: string,
    storeDbPath: string,
  ): Promise<number> {
    const parentRow = sessionsDb.getSessionByProviderSessionId(parentProviderSessionId)
      ?? sessionsDb.getSessionById(parentProviderSessionId);
    const parentSessionId = parentRow?.session_id ?? parentProviderSessionId;

    let agentIds: string[] = [];
    try {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(storeDbPath, { readonly: true, fileMustExist: true });
      try {
        const blobs = db.prepare('SELECT data FROM blobs').all() as Array<{ data?: Buffer }>;
        const found = new Set<string>();
        for (const blob of blobs) {
          if (!blob.data || blob.data[0] !== 0x7b) {
            continue;
          }
          const text = blob.data.toString('utf8');
          if (!text.includes('agentId') && !text.includes('Agent ID:')) {
            continue;
          }
          for (const agentId of extractCursorAgentIds(text)) {
            if (agentId !== parentProviderSessionId && agentId !== parentSessionId) {
              found.add(agentId);
            }
          }
        }
        agentIds = [...found];
      } finally {
        db.close();
      }
    } catch {
      return 0;
    }

    let linked = 0;
    for (const agentId of agentIds) {
      if (sessionsDb.markSessionAsSubagent(agentId, parentSessionId)) {
        linked += 1;
      }
    }

    return linked;
  }
}
