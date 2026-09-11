/**
 * Per-user set of MCP server names the info panel has switched off.
 *
 * Stored as one key inside the existing `user_preferences` table rather than a
 * dedicated table: the value is a plain string array, the merge-patch
 * key/value shape already fits it, and the runtime — which must consult the
 * set on every Claude turn — reads it through the same repository the settings
 * routes write to. Keying by name (not by scope or transport) is deliberate:
 * `~/.claude.json` scoping already decides WHERE a server is defined, and this
 * set is a global on/off keyed by the one thing the user recognizes.
 */

import { getConnection } from '@/modules/database/connection.js';

/** The `user_preferences` key holding the disabled-server name list. */
const DISABLED_KEY = 'mcpDisabledServers';

/**
 * Coerces anything read from the database (or a request body) to clean names.
 *
 * A corrupted row must read as "nothing disabled" rather than throw: a bad
 * preference must never take a chat run down with it.
 */
export function normalizeMcpDisabledServers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      names.add(trimmed);
    }
  }
  return [...names].sort();
}

export const mcpDisabledServersDb = {
  /** Names the user has disabled; empty when they never touched a switch. */
  get(userId: number): string[] {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT preference_value FROM user_preferences WHERE user_id = ? AND preference_key = ?'
      )
      .get(userId, DISABLED_KEY) as { preference_value: string } | undefined;
    if (!row) {
      return [];
    }
    try {
      return normalizeMcpDisabledServers(JSON.parse(row.preference_value));
    } catch {
      console.warn('[McpDisabledServers] Dropping unreadable disabled-server list');
      return [];
    }
  },

  /** Replaces the whole set (the panel always sends the complete list). */
  set(userId: number, value: unknown): string[] {
    const normalized = normalizeMcpDisabledServers(value);
    const db = getConnection();
    db.prepare(
      `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, preference_key) DO UPDATE SET
         preference_value = excluded.preference_value,
         updated_at = CURRENT_TIMESTAMP`
    ).run(userId, DISABLED_KEY, JSON.stringify(normalized));
    return normalized;
  },
};
