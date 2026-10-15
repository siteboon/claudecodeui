import path from 'node:path';

import type {
  SystemServerStartRecord,
  SystemUpdateHistory,
  SystemUpdateRecord,
} from '@/shared/types.js';

type SystemUpdateHistoryDependencies = {
  /** CloudCLI's per-user data folder (`~/.cloudcli`, next to the default auth.db). */
  dataDirectory: string;
  /** Reads a whole UTF-8 file; throws when it is missing. */
  readTextFile(filePath: string): string;
  /** Replaces a whole UTF-8 file, creating missing parent folders. */
  writeTextFile(filePath: string, contents: string): void;
};

function readRecordFile<TRecord>(
  dependencies: SystemUpdateHistoryDependencies,
  filePath: string,
): TRecord | null {
  try {
    const parsedRecord: unknown = JSON.parse(dependencies.readTextFile(filePath));
    return parsedRecord && typeof parsedRecord === 'object' ? parsedRecord as TRecord : null;
  } catch {
    // Missing or hand-edited files read as "not recorded yet".
    return null;
  }
}

/**
 * Creates the store behind CloudCLI's update records: the last server start,
 * the last update attempt, and one plain-text log per update. Everything lives
 * in the data folder so `cloudcli status` can read it while the server is down.
 * Writers decide how to handle a failed write; this store never swallows one.
 */
export function createSystemUpdateHistoryService(dependencies: SystemUpdateHistoryDependencies) {
  const lastStartPath = path.join(dependencies.dataDirectory, 'last-start.json');
  const lastUpdatePath = path.join(dependencies.dataDirectory, 'last-update.json');
  const logDirectory = path.join(dependencies.dataDirectory, 'logs');

  return {
    recordServerStart(record: SystemServerStartRecord): void {
      dependencies.writeTextFile(lastStartPath, `${JSON.stringify(record, null, 2)}\n`);
    },

    /** Names the log of an update started at `startedAt` (no colons, so it is valid on Windows too). */
    getUpdateLogPath(startedAt: Date): string {
      return path.join(logDirectory, `update-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`);
    },

    writeUpdateLog(logPath: string, contents: string): void {
      dependencies.writeTextFile(logPath, contents);
    },

    recordUpdate(record: SystemUpdateRecord): void {
      dependencies.writeTextFile(lastUpdatePath, `${JSON.stringify(record, null, 2)}\n`);
    },

    readHistory(): SystemUpdateHistory {
      return {
        lastStart: readRecordFile<SystemServerStartRecord>(dependencies, lastStartPath),
        lastUpdate: readRecordFile<SystemUpdateRecord>(dependencies, lastUpdatePath),
        lastStartPath,
        lastUpdatePath,
      };
    },
  };
}
