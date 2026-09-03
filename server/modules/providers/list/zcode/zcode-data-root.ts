/**
 * ZCode Data Root
 *
 * Single source of truth for ZCode CLI filesystem locations. The
 * `ZCODE_STORAGE_DIR` override (used by tests and sandboxed setups) applies
 * uniformly to every consumer, so an isolated storage dir is read, watched,
 * and written as one coherent tree.
 *
 * @module zcode-data-root
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the ZCode storage directory (`~/.zcode` by default).
 *
 * Consumers: zcode auth (credentials), zcode models (v2 config), zcode
 * sessions and session synchronizer (database path), zcode protocol client
 * (subprocess environment).
 */
export function getZCodeStorageDir(): string {
  const override = process.env.ZCODE_STORAGE_DIR?.trim();
  return override || path.join(os.homedir(), '.zcode');
}

/**
 * Resolves the path of ZCode's SQLite session database
 * (`<storage>/cli/db/db.sqlite`).
 *
 * Consumers: zcode sessions provider (history/token reads) and zcode session
 * synchronizer (incremental scans). Both open it strictly read-only and in
 * short-lived connections, so the path itself is the only shared fact.
 */
export function getZCodeDatabasePath(): string {
  return path.join(getZCodeStorageDir(), 'cli', 'db', 'db.sqlite');
}
