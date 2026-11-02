import { getConnection } from '@/modules/database/connection.js';
import type { QueuedChatMessage } from '@/shared/types.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * One chat scope's unsent state: the text still in the composer, plus the
 * message queued behind an in-flight turn. Both are optional — a scope can
 * hold only a draft, only a queued message, or both.
 */
export type SessionDraftRecord = {
  scope: string;
  text: string;
  queuedMessage: unknown | null;
  updatedAt: string;
};

type DraftRow = {
  draft_scope: string;
  draft_text: string;
  queued_message: string | null;
  updated_at: string;
};

/** A server-owned queued turn together with the exact stored value used to claim it once. */
export type QueuedSessionMessageRecord = {
  userId: number;
  sessionId: string;
  queuedMessage: unknown;
  claimToken: string;
};

type QueuedMessageRow = {
  user_id: number;
  draft_scope: string;
  queued_message: string;
};

/** A queued message that no longer parses is treated as absent, not fatal. */
function parseQueuedMessage(raw: string | null): unknown | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Joins a message queued later onto the one already waiting, so both are sent
 * in one turn, in the order they were queued. Text is separated by a blank
 * line and attachments keep their order. The later message's send options win:
 * they are the composer settings the user chose most recently.
 */
function mergeQueuedMessages(earlier: QueuedChatMessage, later: QueuedChatMessage): QueuedChatMessage {
  const options = later.options ?? earlier.options;
  return {
    content: [earlier.content, later.content].filter((part) => part.trim()).join('\n\n'),
    ...(options ? { options } : {}),
    attachments: [...earlier.attachments, ...later.attachments],
  };
}

/**
 * Whether a queued message is a slash command, such as "/compact" or
 * "/review src". The CLI takes the command from the start of the message and
 * the rest as its arguments, so a command cannot share a turn with other
 * follow-ups: text added after it would become its arguments, and a command
 * added after text would reach the CLI as plain text.
 */
function isSlashCommand(message: QueuedChatMessage): boolean {
  return message.content.trimStart().startsWith('/');
}

/** The message waiting in a scope's queue, or null when nothing sendable is stored there. */
function readStoredQueuedMessage(userId: number, scope: string): QueuedChatMessage | null {
  const row = getConnection()
    .prepare('SELECT queued_message FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
    .get(userId, scope) as { queued_message: string | null } | undefined;
  return readQueuedChatMessage(parseQueuedMessage(row?.queued_message ?? null));
}

/** Stores a scope's queued message without touching its draft text. */
function writeStoredQueuedMessage(userId: number, scope: string, rawQueuedMessage: string): void {
  getConnection()
    .prepare(
      `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, updated_at)
       VALUES (?, ?, '', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, draft_scope) DO UPDATE SET
         queued_message = excluded.queued_message,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(userId, scope, rawQueuedMessage);
}

function toRecord(row: DraftRow): SessionDraftRecord {
  return {
    scope: row.draft_scope,
    text: row.draft_text,
    queuedMessage: parseQueuedMessage(row.queued_message),
    updatedAt: row.updated_at,
  };
}

export const sessionDraftsDb = {
  /**
   * Returns every draft the user has, newest first.
   *
   * The client pulls the whole set once per load: drafts are short strings, and
   * having them all up front means switching sessions restores a draft written
   * on another device without a round trip.
   */
  getDrafts(userId: number): SessionDraftRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT draft_scope, draft_text, queued_message, updated_at
         FROM session_drafts
         WHERE user_id = ?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(userId) as DraftRow[];

    return rows.map(toRecord);
  },

  /** Lists persisted queued turns whose scopes are real chat sessions. */
  listQueuedMessages(): QueuedSessionMessageRecord[] {
    const rows = getConnection()
      .prepare(
        `SELECT drafts.user_id, drafts.draft_scope, drafts.queued_message
         FROM session_drafts AS drafts
         INNER JOIN sessions ON sessions.session_id = drafts.draft_scope
         WHERE drafts.queued_message IS NOT NULL`
      )
      .all() as QueuedMessageRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      sessionId: row.draft_scope,
      queuedMessage: parseQueuedMessage(row.queued_message),
      claimToken: row.queued_message,
    }));
  },

  /** Atomically removes a queued turn only if it has not been edited since listing. */
  claimQueuedMessage(candidate: QueuedSessionMessageRecord): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE session_drafts
         SET queued_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ? AND queued_message = ?`
      )
      .run(candidate.userId, candidate.sessionId, candidate.claimToken);
    return result.changes > 0;
  },

  /**
   * Restores a claim lost to the narrow race where another run starts first.
   *
   * A message the user queued after the claim stays queued behind the restored
   * one rather than being overwritten by it, so neither is lost and the order
   * they were queued in is kept.
   */
  restoreQueuedMessage(candidate: QueuedSessionMessageRecord): void {
    const restored = readQueuedChatMessage(candidate.queuedMessage);
    if (!restored) {
      return;
    }

    const db = getConnection();
    db.transaction(() => {
      const queuedSinceClaim = readStoredQueuedMessage(candidate.userId, candidate.sessionId);
      writeStoredQueuedMessage(
        candidate.userId,
        candidate.sessionId,
        queuedSinceClaim
          ? JSON.stringify(mergeQueuedMessages(restored, queuedSinceClaim))
          : candidate.claimToken,
      );
    })();
  },

  /**
   * Queues a message to be sent when the session is next idle, after any
   * message already queued for it.
   *
   * A session has one queued turn, so a message queued while another is still
   * waiting is appended to it instead of replacing it: the user sent both.
   * Reading and writing in one transaction keeps this exact against the
   * dispatcher, which claims the stored value: once the earlier message has been
   * claimed for sending, the new one is queued on its own and nothing is sent
   * twice. Returns the message that is now queued and whether it was appended,
   * or null, storing nothing, when the waiting message and this one cannot be
   * one turn because either of them is a slash command.
   */
  appendQueuedMessage(
    userId: number,
    scope: string,
    message: QueuedChatMessage
  ): { queuedMessage: QueuedChatMessage; appended: boolean } | null {
    const db = getConnection();
    return db.transaction(() => {
      const waiting = readStoredQueuedMessage(userId, scope);
      if (waiting && (isSlashCommand(waiting) || isSlashCommand(message))) {
        return null;
      }
      const queuedMessage = waiting ? mergeQueuedMessages(waiting, message) : message;
      writeStoredQueuedMessage(userId, scope, JSON.stringify(queuedMessage));
      return { queuedMessage, appended: waiting !== null };
    })();
  },

  /** Removes a scope's queued message (edited back into the composer or deleted), keeping its text. */
  clearQueuedMessage(userId: number, scope: string): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare(
        `UPDATE session_drafts
         SET queued_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ?`
      ).run(userId, scope);
      sessionDraftsDb.deleteEmptyDraft(userId, scope);
    })();
  },

  /**
   * Removes a row left with neither text nor a queued message: after its last
   * queued turn is claimed, its queued message is cleared, or its text emptied.
   */
  deleteEmptyDraft(userId: number, scope: string): void {
    getConnection()
      .prepare(
        `DELETE FROM session_drafts
         WHERE user_id = ? AND draft_scope = ? AND draft_text = '' AND queued_message IS NULL`
      )
      .run(userId, scope);
  },

  /**
   * Writes one scope's composer text and leaves its queued message alone, or
   * deletes the row when neither is left.
   *
   * The composer saves its text on a debounce, from whatever copy of the queue
   * that page last saw. Writing only the text keeps that save from putting back
   * a queued message the dispatcher has already sent, or from replacing one that
   * another tab has added to.
   */
  saveDraftText(userId: number, scope: string, text: string): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, updated_at)
         VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, draft_scope) DO UPDATE SET
           draft_text = excluded.draft_text,
           updated_at = CURRENT_TIMESTAMP`
      ).run(userId, scope, text);
      sessionDraftsDb.deleteEmptyDraft(userId, scope);
    })();
  },

  /**
   * Writes one scope's draft, or deletes the row when nothing is left to keep.
   *
   * Deleting on empty is what stops the table growing a permanent row for every
   * session the user ever opened and typed a character into.
   */
  saveDraft(
    userId: number,
    scope: string,
    draft: { text: string; queuedMessage: unknown | null }
  ): void {
    const db = getConnection();

    if (!draft.text && draft.queuedMessage === null) {
      db.prepare('DELETE FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
        .run(userId, scope);
      return;
    }

    db.prepare(
      `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, draft_scope) DO UPDATE SET
         draft_text = excluded.draft_text,
         queued_message = excluded.queued_message,
         updated_at = CURRENT_TIMESTAMP`
    ).run(
      userId,
      scope,
      draft.text,
      draft.queuedMessage === null ? null : JSON.stringify(draft.queuedMessage)
    );
  },

  deleteDraft(userId: number, scope: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
      .run(userId, scope);
  },
};
