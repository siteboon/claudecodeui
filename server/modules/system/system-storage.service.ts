import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { AppError } from '@/shared/utils.js';

type SystemStorageDependencies = {
  isPlatform: boolean;
  getDatabasePath(): string;
  getAssetsPath(): string;
  /**
   * Writes a consistent copy of the live database to `destinationPath` and
   * reports how many pages it copied (better-sqlite3's backup metadata).
   */
  backupDatabase(destinationPath: string): Promise<{ totalPages: number }>;
  /** Parent folder for the private, short-lived snapshot directory. */
  temporaryDirectory: string;
  now(): Date;
};

// better-sqlite3 resolves a backup whose first step finds the source busy (a
// write transaction open on the shared connection, or another process holding
// the write lock) as finished with 0 pages, leaving an empty file. Such a
// result is retried briefly instead of being sent as a "backup".
const BACKUP_ATTEMPTS = 5;
const BACKUP_RETRY_DELAY_MS = 200;

/**
 * Hosted (Platform) installs keep their database on infrastructure the
 * platform manages and backs up, and their auth layer trusts the platform proxy
 * instead of a CloudCLI token, so this self-hosting feature stays off there.
 */
function assertSelfHosted(isPlatform: boolean): void {
  if (isPlatform) {
    throw new AppError('Storage locations and database backups are managed by the hosting platform.', {
      code: 'PLATFORM_MANAGED_STORAGE',
      statusCode: 403,
    });
  }
}

/** `2026-10-12T18:30:05.123Z` -> `2026-10-12T18-30-05Z`: sortable and valid on every filesystem. */
function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/**
 * Used by the system module to back GET /api/system/storage and
 * GET /api/system/backup (Settings > About > Data & backup). The live
 * connection and filesystem locations are injected so tests can run against an
 * isolated database.
 */
export function createSystemStorageService(dependencies: SystemStorageDependencies) {
  return {
    /**
     * Returns where this install keeps its state. Both paths are absolute: a
     * relative DATABASE_PATH is opened against the server's working directory.
     */
    getStorageLocations() {
      assertSelfHosted(dependencies.isPlatform);
      return {
        databasePath: path.resolve(dependencies.getDatabasePath()),
        assetsPath: path.resolve(dependencies.getAssetsPath()),
      };
    },

    /**
     * Takes a consistent snapshot of the live database and returns its bytes.
     * The snapshot is written to an owner-only file inside a fresh private
     * directory, which is removed before this resolves or rejects, so no copy
     * of the credential database outlives the request on disk.
     */
    async createDatabaseBackup() {
      assertSelfHosted(dependencies.isPlatform);

      const fileName = `cloudcli-backup-${formatBackupTimestamp(dependencies.now())}.db`;
      const snapshotDirectory = await mkdtemp(path.join(dependencies.temporaryDirectory, 'cloudcli-backup-'));

      try {
        const snapshotPath = path.join(snapshotDirectory, fileName);
        // Create the file owner-only first; SQLite keeps the existing mode when it writes into it.
        await writeFile(snapshotPath, '', { mode: 0o600, flag: 'wx' });
        for (let attempt = 1; ; attempt += 1) {
          const { totalPages } = await dependencies.backupDatabase(snapshotPath);
          if (totalPages > 0) {
            break;
          }
          if (attempt === BACKUP_ATTEMPTS) {
            throw new AppError('The database is busy. Try the backup again in a moment.', {
              code: 'DATABASE_BUSY',
              statusCode: 503,
            });
          }
          await delay(BACKUP_RETRY_DELAY_MS);
        }
        return { fileName, contents: await readFile(snapshotPath) };
      } finally {
        await rm(snapshotDirectory, { recursive: true, force: true });
      }
    },
  };
}
