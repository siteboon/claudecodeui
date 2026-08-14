/**
 * Database connection management.
 *
 * Owns the single SQLite connection used across all repositories.
 * Handles path resolution, directory creation, legacy database migration,
 * and eager app_config bootstrap so the auth middleware can read the
 * JWT secret before the full schema is applied.
 *
 * Consumers should never create their own Database instance — they use
 * `getConnection()` to obtain the shared singleton.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { APP_CONFIG_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';
import { DEFAULT_DATABASE_PATH, readConfiguredDatabasePath } from '@/shared/database-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the database file path.
 *
 * Priority:
 *   1. DATABASE_PATH, when explicitly set (.env, CLI `--db-path`, or the
 *      deployment environment)
 *   2. The default user-level location (~/.cloudcli/auth.db)
 *
 * A legacy server/database/auth.db is not selected here — it is copied into the
 * resolved path by migrateLegacyDatabase() instead.
 *
 * The default is applied here rather than written into process.env so it is not
 * inherited by spawned child processes.
 */
function resolveDatabasePath(): string {
  return readConfiguredDatabasePath() ?? DEFAULT_DATABASE_PATH;
}

/**
 * Resolves the legacy database path (always inside server/database/).
 * Used for the one-time migration to the new external location.
 */
function resolveLegacyDatabasePath(): string {
  const serverDir = path.resolve(__dirname, '..', '..', '..');
  return path.join(serverDir, 'database', 'auth.db');
}

// ---------------------------------------------------------------------------
// Directory & migration helpers
// ---------------------------------------------------------------------------

function ensureDatabaseDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('Created database directory:', dir);
  }
}

/**
 * If the database was moved to an external location (e.g. ~/.cloudcli/)
 * but the user still has a legacy auth.db inside the install directory,
 * copy it to the new location as a one-time migration.
 */
function migrateLegacyDatabase(targetPath: string): void {
  const legacyPath = resolveLegacyDatabasePath();

  if (targetPath === legacyPath) return;
  if (fs.existsSync(targetPath)) return;
  if (!fs.existsSync(legacyPath)) return;

  try {
    fs.copyFileSync(legacyPath, targetPath);
    console.log('Migrated legacy database', { from: legacyPath, to: targetPath });


    // copy the write-ahead log and shared memory files (auth.db-wal, auth.db-shm) if they exist, to preserve any uncommitted transactions
    for (const suffix of ['-wal', '-shm']) {
      const src = legacyPath + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, targetPath + suffix);
      }
    }
  } catch (err: any) {
    console.error('Could not migrate legacy database', { error: err.message });
  }
}


// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

let instance: Database.Database | null = null;
let openedPath: string | null = null;
let lastExistenceCheckAt = 0;

// Checking the file on every getConnection() would add a stat() to every query,
// so the check is throttled: a deleted database recovers within this window.
const STALE_CHECK_INTERVAL_MS = 1000;

/**
 * SQLite error codes that mean the open handle can never succeed again, so the
 * only recovery is to reopen. DBMOVED is raised once SQLite notices the file it
 * opened was renamed or unlinked — which latches the connection read-only for
 * the rest of the process lifetime.
 */
const UNRECOVERABLE_SQLITE_CODES = new Set([
  'SQLITE_READONLY_DBMOVED',
  'SQLITE_READONLY_DIRECTORY',
]);

/**
 * True when an error means the cached handle is permanently unusable.
 *
 * Note this cannot be detected by comparing inodes: deleting and recreating a
 * file in the same directory routinely reuses the inode number *and* reports an
 * unchanged birthtime, so only the error itself is a reliable signal.
 */
export function isDatabaseMovedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && UNRECOVERABLE_SQLITE_CODES.has(code);
}

function discardConnection(reason: string): void {
  if (!instance) return;

  console.warn(`[Database] Reopening connection: ${reason}`, { path: openedPath });

  try {
    instance.close();
  } catch {
    // The handle is already unusable; closing is best-effort.
  }

  instance = null;
  openedPath = null;
}

/**
 * Drops the cached connection when it can no longer serve queries: the handle
 * was closed, the configured path changed, or the file was deleted outright.
 * Safe because no repository caches prepared statements across calls.
 */
function discardConnectionIfUnusable(): void {
  if (!instance) return;

  if (!instance.open) {
    discardConnection('the handle was closed');
    return;
  }

  const dbPath = resolveDatabasePath();
  if (dbPath !== openedPath) {
    discardConnection(`the configured path changed to ${dbPath}`);
    return;
  }

  const now = Date.now();
  if (now - lastExistenceCheckAt < STALE_CHECK_INTERVAL_MS) return;
  lastExistenceCheckAt = now;

  if (!fs.existsSync(dbPath)) {
    discardConnection('the database file no longer exists');
  }
}

/**
 * Reopens the connection when `error` indicates the database file was moved or
 * deleted. Returns true when a retry is worth attempting.
 *
 * Without this a single replaced file leaves every subsequent write failing
 * until the process restarts.
 */
export function recoverFromDatabaseError(error: unknown): boolean {
  if (!isDatabaseMovedError(error)) return false;

  discardConnection('a query reported the database file was moved or deleted');
  return true;
}

/**
 * Returns the shared database connection, creating it on first call.
 *
 * The first invocation:
 *   1. Resolves the target database path
 *   2. Ensures the parent directory exists
 *   3. Migrates from the legacy install-directory path if needed
 *   4. Opens the SQLite connection
 *   5. Eagerly creates the app_config table (auth reads JWT secret at import time)
 *   6. Logs the database location
 */
export function getConnection(): Database.Database {
  if (instance) {
    discardConnectionIfUnusable();
    if (instance) return instance;
  }

  const dbPath = resolveDatabasePath();

  ensureDatabaseDirectory(dbPath);
  migrateLegacyDatabase(dbPath);

  instance = new Database(dbPath);

  // app_config must exist immediately — the auth middleware reads
  // the JWT secret at module-load time, before initializeDatabase() runs.
  instance.exec(APP_CONFIG_TABLE_SCHEMA_SQL);

  openedPath = dbPath;
  lastExistenceCheckAt = Date.now();

  return instance;
}

/**
 * Returns the resolved database file path without opening a connection.
 * Useful for diagnostics and CLI status commands.
 */
export function getDatabasePath(): string {
  return resolveDatabasePath();
}

/**
 * Closes the database connection and clears the singleton.
 * Primarily used for graceful shutdown or testing.
 */
export function closeConnection(): void {
  if (instance) {
    instance.close();
    instance = null;
    openedPath = null;
    lastExistenceCheckAt = 0;
    console.log('Database connection closed');
  }
}
