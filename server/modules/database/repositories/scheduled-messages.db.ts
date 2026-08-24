import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type ScheduledMessageRow = {
  id: string;
  user_id: number;
  session_id: string;
  content: string;
  options: string;
  scheduled_for: string;
  status: ScheduledMessageStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  'id, user_id, session_id, content, options, scheduled_for, status, failure_reason, created_at, updated_at';

export const scheduledMessagesDb = {
  create(input: {
    userId: number;
    sessionId: string;
    content: string;
    options: unknown;
    scheduledFor: Date;
  }): ScheduledMessageRow {
    const db = getConnection();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO scheduled_messages (id, user_id, session_id, content, options, scheduled_for, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      id,
      input.userId,
      input.sessionId,
      input.content,
      JSON.stringify(input.options ?? {}),
      input.scheduledFor.toISOString(),
    );

    return db.prepare(`SELECT ${COLUMNS} FROM scheduled_messages WHERE id = ?`).get(id) as ScheduledMessageRow;
  },

  /** Everything still to come or recently resolved, newest schedule first. */
  listForSession(userId: number, sessionId: string): ScheduledMessageRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE user_id = ? AND session_id = ?
         ORDER BY scheduled_for ASC`
      )
      .all(userId, sessionId) as ScheduledMessageRow[];
  },

  listPendingForUser(userId: number): ScheduledMessageRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS} FROM scheduled_messages
         WHERE user_id = ? AND status = 'pending'
         ORDER BY scheduled_for ASC`
      )
      .all(userId) as ScheduledMessageRow[];
  },

  /**
   * Claims every message whose time has passed, marking them in the same
   * statement that selects them.
   *
   * Claiming is what makes a missed schedule work: the server can be down at
   * the moment a message was due, and the next poll after it starts picks the
   * message up instead of skipping it. Doing it in one transaction is what
   * stops two overlapping polls from sending the same message twice.
   */
  claimDue(now: Date): ScheduledMessageRow[] {
    const db = getConnection();
    const nowIso = now.toISOString();

    return db.transaction(() => {
      const due = db
        .prepare(
          `SELECT ${COLUMNS} FROM scheduled_messages
           WHERE status = 'pending' AND scheduled_for <= ?
           ORDER BY scheduled_for ASC`
        )
        .all(nowIso) as ScheduledMessageRow[];

      for (const row of due) {
        db.prepare(
          `UPDATE scheduled_messages SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(row.id);
      }

      return due;
    })();
  },

  markFailed(id: string, reason: string): void {
    getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(reason.slice(0, 500), id);
  },

  /** Cancels a pending message. Returns false when it had already fired. */
  cancel(userId: number, id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status = 'pending'`
      )
      .run(id, userId);

    return result.changes > 0;
  },
};
