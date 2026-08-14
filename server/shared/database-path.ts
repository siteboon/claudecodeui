// Single source of truth for the default database location.
//
// This is deliberately a plain module constant rather than a `process.env`
// assignment: anything written to `process.env` is inherited by every child
// process the app spawns (terminal sessions, git clones, plugin hosts). A dev
// server started from an in-app terminal would then silently open the running
// production database instead of its own.
import os from 'os';
import path from 'path';

/**
 * Default database file, kept in a stable user-level location so rebuilding
 * dist-server never changes where the backend stores auth.db.
 */
export const DEFAULT_DATABASE_PATH = path.join(os.homedir(), '.cloudcli', 'auth.db');

/**
 * Reads an explicitly configured database path (env var or CLI `--db-path`).
 * Returns undefined when unset or blank so callers fall back to the default.
 */
export function readConfiguredDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return environment.DATABASE_PATH?.trim() || undefined;
}
