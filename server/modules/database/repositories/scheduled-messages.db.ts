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
   * Every pending message whose time has passed, oldest first, leaving out the
   * sessions in `busySessionIds` (the dispatcher is still sending an earlier
   * turn into them).
   *
   * Listing does not claim: the dispatcher claims each message with `claim`
   * only when its turn to be sent comes. A due message that is still waiting,
   * behind an earlier one for its session or for a busy session to free up,
   * therefore stays pending: listed and cancellable in the composer, and still
   * here for the first poll after a restart. That is also what makes a missed
   * schedule work: the server can be down at the moment a message was due, and
   * the first poll after it starts finds the message instead of skipping it.
   */
  listDue(now: Date, busySessionIds: ReadonlySet<string> = new Set()): ScheduledMessageRow[] {
    return (
      getConnection()
        .prepare(
          `SELECT ${COLUMNS} FROM scheduled_messages
           WHERE status = 'pending' AND scheduled_for <= ?
           ORDER BY scheduled_for ASC`
        )
        .all(now.toISOString()) as ScheduledMessageRow[]
    ).filter((row) => !busySessionIds.has(row.session_id));
  },

  /**
   * Marks a pending message as sent, right before it is sent. Returns false
   * when it is no longer pending: it was cancelled while it waited, or another
   * pass claimed it first.
   *
   * The status check and the update are one statement, which SQLite applies
   * atomically, so two overlapping passes cannot both claim (and send) the same
   * message, and a cancel that lands first always wins.
   */
  claim(id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'sent', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      )
      .run(id);

    return result.changes > 0;
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

  /**
   * Cancels a pending message, or dismisses a failed one so its banner goes
   * away. Returns false when it had already fired successfully.
   */
  cancel(userId: number, id: string): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE scheduled_messages
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')`
      )
      .run(id, userId);

    return result.changes > 0;
  },
};
