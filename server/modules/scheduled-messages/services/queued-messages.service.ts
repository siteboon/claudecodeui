import { queuedMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type { QueuedMessageRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

const MAX_CONTENT_LENGTH = 100_000;
/** More than this behind one turn is almost certainly a stuck client. */
const MAX_QUEUED_PER_SESSION = 20;

export type QueuedMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
  createdAt: string;
};

function toQueuedMessage(row: QueuedMessageRow): QueuedMessage {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(row.message);
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // Shown as empty rather than failing the whole list.
  }
  const options = parsed.options && typeof parsed.options === 'object' && !Array.isArray(parsed.options)
    ? parsed.options as Record<string, unknown>
    : {};
  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments
    : Array.isArray(parsed.images) ? parsed.images : [];
  return {
    id: row.id,
    sessionId: row.session_id,
    content: typeof parsed.content === 'string' ? parsed.content : '',
    options,
    attachments,
    createdAt: row.created_at,
  };
}

export const queuedMessagesService = {
  enqueue(input: { userId: number; sessionId: string; content: string; options?: unknown; attachments?: unknown }): QueuedMessage {
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (!input.content.trim() && attachments.length === 0) {
      throw new AppError('A queued message needs text or an attachment.', { code: 'CONTENT_REQUIRED', statusCode: 400 });
    }
    if (input.content.length > MAX_CONTENT_LENGTH) {
      throw new AppError('That message is too long to queue.', { code: 'CONTENT_TOO_LONG', statusCode: 400 });
    }
    if (!sessionsDb.getSessionById(input.sessionId)) {
      throw new AppError(`Session "${input.sessionId}" was not found.`, { code: 'SESSION_NOT_FOUND', statusCode: 404 });
    }
    if (queuedMessagesDb.listForSession(input.userId, input.sessionId).length >= MAX_QUEUED_PER_SESSION) {
      throw new AppError('Too many messages are already queued for this session.', { code: 'QUEUE_FULL', statusCode: 409 });
    }
    const options = input.options && typeof input.options === 'object' && !Array.isArray(input.options) ? input.options : {};
    return toQueuedMessage(queuedMessagesDb.enqueue(input.userId, input.sessionId, {
      content: input.content,
      options,
      attachments,
    }));
  },

  listForSession(userId: number, sessionId: string): QueuedMessage[] {
    return queuedMessagesDb.listForSession(userId, sessionId).map(toQueuedMessage);
  },

  /** Removing one that was already sent is not an error: the card just goes away. */
  remove(userId: number, id: string): boolean {
    return queuedMessagesDb.remove(userId, id);
  },
};
