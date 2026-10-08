import { getConnection } from '@/modules/database/connection.js';
import { AppError } from '@/shared/index.js';
import type { QueuedMessage, QueueSteerResult } from '@/shared/index.js';

type QueueRow = {
  id: string;
  sequence: number;
  user_id: number;
  session_id: string;
  content: string;
  options: string;
  attachments: string;
  revision: number;
  status: QueuedMessage['status'];
  error: string | null;
};
function fromRow(row: QueueRow): QueuedMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    userId: row.user_id,
    sessionId: row.session_id,
    content: row.content,
    options: JSON.parse(row.options),
    attachments: JSON.parse(row.attachments),
    revision: row.revision,
    status: row.status,
    error: row.error,
  };
}

/** Used by Scheduled Messages to persist and conditionally consume individual FIFO entries. */
export const queuedMessagesDb = {
  get(userId: number, id: string): QueuedMessage | null {
    const row = getConnection()
      .prepare('SELECT * FROM queued_messages WHERE user_id = ? AND id = ?')
      .get(userId, id) as QueueRow | undefined;
    return row ? fromRow(row) : null;
  },
  list(userId: number, sessionId: string): QueuedMessage[] {
    return (
      getConnection()
        .prepare(
          `SELECT * FROM queued_messages WHERE user_id = ? AND session_id = ?
      AND status NOT IN ('consumed','cancelled') ORDER BY sequence`,
        )
        .all(userId, sessionId) as QueueRow[]
    ).map(fromRow);
  },
  insert(
    input: Pick<
      QueuedMessage,
      'id' | 'userId' | 'sessionId' | 'content' | 'options' | 'attachments'
    >,
  ): QueuedMessage {
    getConnection()
      .prepare(
        `INSERT OR IGNORE INTO queued_messages
      (id,user_id,session_id,content,options,attachments) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.userId,
        input.sessionId,
        input.content,
        JSON.stringify(input.options),
        JSON.stringify(input.attachments),
      );
    const row = this.get(input.userId, input.id);
    if (!row)
      throw new AppError('Queue message id is already in use.', {
        code: 'QUEUE_CONFLICT',
        statusCode: 409,
      });
    return row;
  },
  update(
    input: Pick<
      QueuedMessage,
      'id' | 'userId' | 'revision' | 'content' | 'options' | 'attachments'
    >,
  ): boolean {
    return (
      getConnection()
        .prepare(
          `UPDATE queued_messages SET content = ?, options = ?, attachments = ?,
      revision = revision + 1, status = 'queued', error = NULL
      WHERE id = ? AND user_id = ? AND revision = ? AND status IN ('queued','failed')`,
        )
        .run(
          input.content,
          JSON.stringify(input.options),
          JSON.stringify(input.attachments),
          input.id,
          input.userId,
          input.revision,
        ).changes > 0
    );
  },
  cancel(userId: number, id: string, revision: number): boolean {
    return (
      getConnection()
        .prepare(
          `UPDATE queued_messages SET status = 'cancelled', revision = revision + 1
      WHERE id = ? AND user_id = ? AND revision = ? AND status IN ('queued','failed','unknown')`,
        )
        .run(id, userId, revision).changes > 0
    );
  },
  heads(): QueuedMessage[] {
    return (
      getConnection()
        .prepare(
          `SELECT q.* FROM queued_messages q WHERE q.status = 'queued'
      AND NOT EXISTS (SELECT 1 FROM queued_messages earlier WHERE earlier.session_id = q.session_id
        AND earlier.sequence < q.sequence AND earlier.status NOT IN ('consumed','cancelled'))
      AND NOT EXISTS (SELECT 1 FROM queued_messages busy WHERE busy.session_id = q.session_id
        AND busy.status IN ('dispatching','steering','unknown')) ORDER BY q.sequence`,
        )
        .all() as QueueRow[]
    ).map(fromRow);
  },
  claim(message: QueuedMessage, kind: 'dispatching' | 'steering'): boolean {
    return (
      getConnection()
        .prepare(
          `UPDATE queued_messages SET status = ? WHERE id = ? AND user_id = ?
      AND revision = ? AND status = 'queued'
      AND NOT EXISTS (SELECT 1 FROM queued_messages busy WHERE busy.session_id = ?
        AND busy.status IN ('dispatching','steering','unknown'))`,
        )
        .run(
          kind,
          message.id,
          message.userId,
          message.revision,
          message.sessionId,
        ).changes > 0
    );
  },
  finish(
    message: QueuedMessage,
    kind: 'dispatching' | 'steering',
    status: QueuedMessage['status'],
    error: string | null = null,
  ): void {
    getConnection()
      .prepare(
        `UPDATE queued_messages SET status = ?, error = ?, revision = revision + 1
      WHERE id = ? AND user_id = ? AND revision = ? AND status = ?`,
      )
      .run(status, error, message.id, message.userId, message.revision, kind);
  },
  operation(
    userId: number,
    requestId: string,
  ): (QueueSteerResult & { revision: number; turnToken: string }) | null {
    const row = getConnection()
      .prepare(
        'SELECT * FROM queue_steer_operations WHERE user_id = ? AND request_id = ?',
      )
      .get(userId, requestId) as
      | {
          request_id: string;
          message_id: string;
          session_id: string;
          revision: number;
          turn_token: string;
          status: QueueSteerResult['status'];
          error: string | null;
        }
      | undefined;
    return row
      ? {
          requestId: row.request_id,
          messageId: row.message_id,
          sessionId: row.session_id,
          revision: row.revision,
          turnToken: row.turn_token,
          status: row.status,
          error: row.error,
        }
      : null;
  },
  reserveSteer(
    message: QueuedMessage,
    requestId: string,
    turnToken: string,
  ): boolean {
    return getConnection().transaction(() => {
      if (
        getConnection()
          .prepare('SELECT 1 FROM queue_steer_operations WHERE request_id = ?')
          .get(requestId)
      )
        return false;
      if (!this.claim(message, 'steering')) return false;
      getConnection()
        .prepare(
          `INSERT INTO queue_steer_operations
        (request_id,user_id,message_id,session_id,revision,turn_token,status) VALUES (?,?,?,?,?,?,'pending')`,
        )
        .run(
          requestId,
          message.userId,
          message.id,
          message.sessionId,
          message.revision,
          turnToken,
        );
      return true;
    })();
  },
  finishSteer(
    message: QueuedMessage,
    requestId: string,
    status: 'accepted' | 'rejected' | 'unknown',
    error: string | null,
  ): void {
    getConnection().transaction(() => {
      this.finish(
        message,
        'steering',
        status === 'accepted'
          ? 'consumed'
          : status === 'rejected'
            ? 'queued'
            : 'unknown',
        error,
      );
      getConnection()
        .prepare(
          'UPDATE queue_steer_operations SET status = ?, error = ? WHERE request_id = ? AND status = ?',
        )
        .run(status, error, requestId, 'pending');
    })();
  },
  recoverClaims(): void {
    getConnection().transaction(() => {
      getConnection()
        .prepare(
          `UPDATE queued_messages SET status = 'unknown', revision = revision + 1,
        error = 'The server restarted before delivery could be confirmed.' WHERE status IN ('dispatching','steering')`,
        )
        .run();
      getConnection()
        .prepare(
          `UPDATE queue_steer_operations SET status = 'unknown',
        error = 'The server restarted before delivery could be confirmed.' WHERE status = 'pending'`,
        )
        .run();
    })();
  },
};
