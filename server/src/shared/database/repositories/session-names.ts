/**
 * Session names repository.
 *
 * Manages custom display names for provider sessions. When a user
 * renames a chat session in the UI, the override is stored here
 * and applied on top of the CLI-generated summary.
 */

import { getConnection } from '@/shared/database/connection.js';
import type {
  SessionNameLookupRow,
  SessionWithSummary,
} from '@/shared/database/types.js';
import { logger } from '@/shared/utils/logger.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const sessionNamesDb = {
  /** Inserts or updates a custom session name (upsert on session_id + provider). */
  setName(sessionId: string, provider: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO session_names (session_id, provider, custom_name)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id, provider)
       DO UPDATE SET custom_name = excluded.custom_name,
                     updated_at = CURRENT_TIMESTAMP`
    ).run(sessionId, provider, customName);
  },

  /** Returns the custom name for a single session, or null if unset. */
  getName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?'
      )
      .get(sessionId, provider) as { custom_name: string } | undefined;
    return row?.custom_name ?? null;
  },

  /**
   * Batch lookup for multiple session IDs.
   * Returns a Map<sessionId, customName> for efficient overlay onto session lists.
   */
  getNames(sessionIds: string[], provider: string): Map<string, string> {
    if (sessionIds.length === 0) return new Map();

    const db = getConnection();
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT session_id, custom_name FROM session_names
         WHERE session_id IN (${placeholders}) AND provider = ?`
      )
      .all(...sessionIds, provider) as SessionNameLookupRow[];

    return new Map(rows.map((r) => [r.session_id, r.custom_name]));
  },

  /** Removes a custom session name. Returns true if a row was deleted. */
  deleteName(sessionId: string, provider: string): boolean {
    const db = getConnection();
    return (
      db
        .prepare(
          'DELETE FROM session_names WHERE session_id = ? AND provider = ?'
        )
        .run(sessionId, provider).changes > 0
    );
  },
};

// ---------------------------------------------------------------------------
// Session overlay helper
// ---------------------------------------------------------------------------

/**
 * Overlays custom session names from the database onto a list of sessions.
 * Mutates each session's `summary` field in-place when a custom name exists.
 *
 * This is the typed equivalent of the legacy `applyCustomSessionNames` function.
 * Non-fatal: logs a warning on failure instead of throwing.
 */
export function applyCustomSessionNames(
  sessions: SessionWithSummary[] | undefined | null,
  provider: string
): void {
  if (!sessions?.length) return;

  try {
    const ids = sessions.map((s) => s.id);
    const customNames = sessionNamesDb.getNames(ids, provider);

    for (const session of sessions) {
      const custom = customNames.get(session.id);
      if (custom) {
        session.summary = custom;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to apply custom session names for ${provider}`, {
      error: message,
    });
  }
}
