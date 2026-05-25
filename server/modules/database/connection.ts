/**
 * Database connection — in-memory only.
 *
 * No file is created on disk. The database is a runtime cache for
 * sessions/projects metadata that gets rebuilt from `~/.claude/` on each
 * server boot via the session synchronizer. Auth/login was removed, so
 * there is nothing user-specific worth persisting.
 */

import Database from 'better-sqlite3';

import { APP_CONFIG_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';

let instance: Database.Database | null = null;

export function getConnection(): Database.Database {
  if (instance) return instance;

  instance = new Database(':memory:');

  // app_config is touched at module-load time by some legacy callers
  // (e.g. JWT secret bootstrap). Keep the table around so those reads
  // don't crash, even though the values are now ephemeral.
  instance.exec(APP_CONFIG_TABLE_SCHEMA_SQL);

  return instance;
}

export function getDatabasePath(): string {
  return ':memory:';
}

export function closeConnection(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
