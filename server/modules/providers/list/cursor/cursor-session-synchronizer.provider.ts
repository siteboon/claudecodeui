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
 *
 * Recent cursor-agent versions write JSONL transcripts under
 *   ~/.cursor/projects/<project-dir>/agent-transcripts/<chatId>/<chatId>.jsonl
 * (sometimes nested one level deeper). The legacy
 *   ~/.cursor/chats/<projectHash>/
 * directory still exists but now holds SQLite `store.db` files used by the
 * loader (cursor-sessions.provider.ts), not JSONL the indexer can parse.
 */
export class CursorSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'cursor' as const;
  private readonly cursorHome = path.join(os.homedir(), '.cursor');

  /**
   * Scans Cursor transcripts and upserts discovered sessions into DB.
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

      const projectDir = path.join(projectsDir, entry.name);
      const workerLogPath = path.join(projectDir, 'worker.log');
      const projectPath = await this.extractProjectPathFromWorkerLog(workerLogPath);
      if (!projectPath || seenProjectPaths.has(projectPath)) {
        continue;
      }
      seenProjectPaths.add(projectPath);

      const transcriptsDir = path.join(projectDir, 'agent-transcripts');
      const files = await findFilesRecursivelyCreatedAfter(transcriptsDir, '.jsonl', since ?? null);

      for (const filePath of files) {
        const parsed = await this.processSessionFile(filePath, projectPath);
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
   * Parses and upserts one Cursor session JSONL file (called by the file watcher).
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
   * Walks up from a transcript file looking for the project's worker.log.
   *
   * Cursor has nested transcripts at varying depths over time
   * (`agent-transcripts/<chatId>/<file>.jsonl` and
   *  `agent-transcripts/<chatId>/<sub>/<file>.jsonl` both occur in the wild),
   * so a fixed `dirname()` count silently skipped the deeper variant.
   */
  private async findProjectDirForTranscript(filePath: string): Promise<string | null> {
    const projectsRoot = path.join(this.cursorHome, 'projects');
    let current = path.dirname(filePath);
    while (current.startsWith(projectsRoot + path.sep) && current !== projectsRoot) {
      try {
        await fsp.access(path.join(current, 'worker.log'));
        return current;
      } catch {
        // keep walking up
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
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
  private async processSessionFile(
    filePath: string,
    projectPathHint?: string
  ): Promise<ParsedSession | null> {
    const sessionId = path.basename(filePath, '.jsonl');

    let projectPath = projectPathHint ?? null;
    if (!projectPath) {
      const projectDir = await this.findProjectDirForTranscript(filePath);
      if (!projectDir) {
        return null;
      }
      projectPath = await this.extractProjectPathFromWorkerLog(path.join(projectDir, 'worker.log'));
      if (!projectPath) {
        return null;
      }
    }

    const resolvedProjectPath = projectPath;
    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, any>;
      if (data.role !== 'user') {
        return null;
      }

      const text = typeof data.message?.content?.[0]?.text === 'string' ? data.message.content[0].text : '';
      const firstLine = text.replace(/<\/?user_query>/g, '').trim().split('\n')[0];

      return {
        sessionId,
        projectPath: resolvedProjectPath,
        sessionName: normalizeSessionName(firstLine, 'Untitled Cursor Session'),
      };
    });
  }
}
