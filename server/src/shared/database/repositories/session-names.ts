/**
 * Session names repository.
 *
 * Stores provider-scoped custom names for sessions and exposes helpers
 * to overlay those names onto in-memory session lists.
 */

import { getConnection } from '@/shared/database/connection.js';
import type {
  SessionNameLookupRow,
  SessionWithSummary,
} from '@/shared/database/types.js';

export const sessionNamesDb = {
  /** Upserts a custom session name for a provider-scoped session id. */
  createSessionName(sessionId: string, provider: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO session_names (session_id, provider, custom_name)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id, provider)
       DO UPDATE SET custom_name = excluded.custom_name, updated_at = CURRENT_TIMESTAMP`
    ).run(sessionId, provider, customName);
  },

  /** Alias to keep write semantics explicit when callers perform edits. */
  updateSessionName(sessionId: string, provider: string, customName: string): void {
    sessionNamesDb.createSessionName(sessionId, provider, customName);
  },

  /** Returns a custom name for one session/provider pair or null if unset. */
  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?'
      )
      .get(sessionId, provider) as { custom_name: string } | undefined;
    return row?.custom_name ?? null;
  },

  /**
   * Batch lookup for multiple session ids.
   * Returns a Map<sessionId, customName> for efficient overlay onto lists.
   */
  getSessionNames(sessionIds: string[], provider: string): Map<string, string> {
    if (sessionIds.length === 0) return new Map();

    const db = getConnection();
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT session_id, custom_name FROM session_names
         WHERE session_id IN (${placeholders}) AND provider = ?`
      )
      .all(...sessionIds, provider) as SessionNameLookupRow[];

    return new Map(rows.map((row) => [row.session_id, row.custom_name]));
  },

  /** Deletes a custom name. Returns true if a row was removed. */
  deleteSessionName(sessionId: string, provider: string): boolean {
    const db = getConnection();
    return (
      db
        .prepare(
          'DELETE FROM session_names WHERE session_id = ? AND provider = ?'
        )
        .run(sessionId, provider).changes > 0
    );
  },

  // Legacy aliases used by existing routes/services
  setName(sessionId: string, provider: string, customName: string): void {
    sessionNamesDb.createSessionName(sessionId, provider, customName);
  },
  getName(sessionId: string, provider: string): string | null {
    return sessionNamesDb.getSessionName(sessionId, provider);
  },
  getNames(sessionIds: string[], provider: string): Map<string, string> {
    return sessionNamesDb.getSessionNames(sessionIds, provider);
  },
  deleteName(sessionId: string, provider: string): boolean {
    return sessionNamesDb.deleteSessionName(sessionId, provider);
  },
};

/**
 * Overlay custom names onto a session list in place.
 * If a custom name exists, `summary` is replaced.
 */
export function applyCustomSessionNames(
  sessions: SessionWithSummary[] | undefined | null,
  provider: string
): void {
  if (!sessions?.length) return;

  const ids = sessions.map((session) => session.id);
  const customNames = sessionNamesDb.getSessionNames(ids, provider);
  for (const session of sessions) {
    const customName = customNames.get(session.id);
    if (customName) {
      session.summary = customName;
    }
  }
}
