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
 * Returns whether a directory entry is a directory, following symlinks.
 */
async function isDirectoryEntry(parentDir: string, entry: import('node:fs').Dirent): Promise<boolean> {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fsp.stat(path.join(parentDir, entry.name))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves a Cursor project folder name back to the workspace path it encodes.
 *
 * Cursor names `~/.cursor/projects/<name>` after the workspace path with every
 * non-alphanumeric character replaced by `-`, so `/Users/me/my_app-2.0`
 * becomes `Users-me-my-app-2-0`. That mapping is lossy, so the name is matched
 * against real directory entries one level at a time, backtracking on
 * ambiguous prefixes. Returns null when the workspace no longer exists, or
 * when several existing paths encode to the same name (e.g. `my-app` and
 * `my_app` side by side), since picking one could file sessions under the
 * wrong project.
 */
async function resolveEncodedProjectPath(encodedName: string): Promise<string | null> {
  const matches: string[] = [];
  await collectEncodedPathMatches(encodedName, path.parse(process.cwd()).root, matches);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Appends every existing directory under `currentDir` whose encoded path equals
 * `encodedRest` to `matches`, stopping once two are found (enough to prove ambiguity).
 */
async function collectEncodedPathMatches(encodedRest: string, currentDir: string, matches: string[]): Promise<void> {
  if (encodedRest === '') {
    matches.push(currentDir);
    return;
  }

  for (const entry of await listDirectoryEntriesSafe(currentDir)) {
    const encodedName = entry.name.replace(/[^A-Za-z0-9]/g, '-');
    if (encodedRest !== encodedName && !encodedRest.startsWith(`${encodedName}-`)) {
      continue;
    }
    if (!(await isDirectoryEntry(currentDir, entry))) {
      continue;
    }

    await collectEncodedPathMatches(
      encodedRest.slice(encodedName.length + 1),
      path.join(currentDir, entry.name),
      matches
    );
    if (matches.length > 1) {
      return;
    }
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
        filePath
      );
      processed += 1;
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
    const grandparentDir = path.dirname(path.dirname(path.dirname(filePath)));
    const workerLogPath = path.join(grandparentDir, 'worker.log');
    let projectPath = await this.extractProjectPathFromWorkerLog(workerLogPath);

    // Newer Cursor builds no longer log `workspacePath=` (and most projects have
    // no worker.log at all), so fall back to decoding the project folder name.
    // Only top-level transcripts qualify; nested subagent transcripts stay skipped.
    if (!projectPath && path.dirname(grandparentDir) === path.join(this.cursorHome, 'projects')) {
      projectPath = await resolveEncodedProjectPath(path.basename(grandparentDir));
    }

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
      };
    });
  }
}
