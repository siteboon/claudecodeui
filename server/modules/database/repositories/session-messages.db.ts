/**
 * Cloud-side session message log used by the control plane.
 *
 * Stores normalized chat envelopes so the web UI can reload history even when
 * Worker-local provider transcripts are missing. Native CLI resume still depends
 * on Worker-local artifacts; this table is the Server copy.
 */

import { getConnection } from '@/modules/database/connection.js';

export type SessionMessageRow = {
  id: number;
  session_id: string;
  seq: number | null;
  kind: string;
  payload_json: string;
  created_at: string;
};

export const sessionMessagesDb = {
  /** Appends one normalized outbound chat event for a session. */
  appendMessage(input: {
    sessionId: string;
    seq?: number | null;
    kind: string;
    payload: unknown;
  }): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO session_messages (session_id, seq, kind, payload_json)
       VALUES (?, ?, ?, ?)`,
    ).run(
      input.sessionId,
      input.seq ?? null,
      input.kind,
      JSON.stringify(input.payload),
    );
  },

  /** Returns stored messages for a session in insertion order. */
  listMessages(sessionId: string, options: { limit?: number; offset?: number } = {}): SessionMessageRow[] {
    const db = getConnection();
    const limit = options.limit;
    const offset = options.offset ?? 0;

    if (typeof limit === 'number') {
      return db
        .prepare(
          `SELECT id, session_id, seq, kind, payload_json, created_at
           FROM session_messages
           WHERE session_id = ?
           ORDER BY id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(sessionId, limit, offset) as SessionMessageRow[];
    }

    return db
      .prepare(
        `SELECT id, session_id, seq, kind, payload_json, created_at
         FROM session_messages
         WHERE session_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId) as SessionMessageRow[];
  },

  countMessages(sessionId: string): number {
    const db = getConnection();
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  },
};
