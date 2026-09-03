/**
 * OpenCode Data Root
 *
 * Single source of truth for OpenCode CLI filesystem locations. Mirrors the
 * antigravity/zcode data-root convention so provider path knowledge lives in
 * the provider module rather than the global shared layer.
 *
 * @module opencode-data-root
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the OpenCode SQLite session database path.
 *
 * OpenCode stores session, message, part, and project metadata in one shared
 * `opencode.db` file under its XDG data directory. Provider readers and
 * synchronizers should use this path for read-only access and should never
 * store it as a deletable transcript path for an individual app session row.
 *
 * Consumers: opencode models, sessions, and session synchronizer providers.
 */
export function getOpenCodeDatabasePath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}
