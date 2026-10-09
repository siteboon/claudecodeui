import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type QueuedMessageRow = {
  id: string;
  user_id: number;
  session_id: string;
  message: string;
  created_at: string;
};

const COLUMNS = 'id, user_id, session_id, message, created_at';

export const queuedMessagesDb = {
  enqueue(userId: number, sessionId: string, message: unknown): QueuedMessageRow {
    const db = getConnection();
    const id = randomUUID();
    // Millisecond ISO timestamps keep two messages queued in the same second in order.
    db.prepare(
      `INSERT INTO queued_messages (id, user_id, session_id, message, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, userId, sessionId, JSON.stringify(message ?? {}), new Date().toISOString());
    return db.prepare(`SELECT ${COLUMNS} FROM queued_messages WHERE id = ?`).get(id) as QueuedMessageRow;
  },

  listForSession(userId: number, sessionId: string): QueuedMessageRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM queued_messages
         WHERE user_id = ? AND session_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(userId, sessionId) as QueuedMessageRow[];
  },

  /** Sessions that have something queued, for the dispatcher. */
  listQueuedSessionIds(): string[] {
    const rows = getConnection()
      .prepare(
        `SELECT DISTINCT queued.session_id FROM queued_messages AS queued
         INNER JOIN sessions ON sessions.session_id = queued.session_id`
      )
      .all() as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id);
  },

  /**
   * Removes and returns the session's oldest queued message.
   *
   * Deleting in the same transaction that selects it is what stops two
   * overlapping dispatcher passes from sending it twice.
   */
  claimOldest(sessionId: string): QueuedMessageRow | null {
    const db = getConnection();
    return db.transaction(() => {
      const row = db
        .prepare(
          `SELECT ${COLUMNS} FROM queued_messages WHERE session_id = ?
           ORDER BY created_at ASC, rowid ASC LIMIT 1`
        )
        .get(sessionId) as QueuedMessageRow | undefined;
      if (!row) return null;
      db.prepare('DELETE FROM queued_messages WHERE id = ?').run(row.id);
      return row;
    })();
  },

  /** Puts a claimed message back at its original place in the queue. */
  restore(row: QueuedMessageRow): void {
    getConnection()
      .prepare(
        `INSERT OR IGNORE INTO queued_messages (id, user_id, session_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(row.id, row.user_id, row.session_id, row.message, row.created_at);
  },

  /** Returns false when it was already sent (or never belonged to this user). */
  remove(userId: number, id: string): boolean {
    const result = getConnection()
      .prepare('DELETE FROM queued_messages WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  },
};
