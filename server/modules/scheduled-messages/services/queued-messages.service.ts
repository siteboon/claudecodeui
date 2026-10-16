import { queuedMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type {
  QueuedMessage,
  QueueSteerResult,
  ProviderSteerInput,
} from '@/shared/index.js';
import {
  AppError,
  readObjectRecord,
  normalizeAttachmentDescriptors,
} from '@/shared/index.js';

function conflict(): never {
  throw new AppError(
    'This queued message changed or is already being delivered. Refresh the queue.',
    {
      code: 'QUEUE_CONFLICT',
      statusCode: 409,
    },
  );
}
function readMessage(input: {
  content?: unknown;
  options?: unknown;
  attachments?: unknown;
}) {
  const content = typeof input.content === 'string' ? input.content : '';
  const attachments = normalizeAttachmentDescriptors(input.attachments);
  if (
    (!content.trim() && !attachments.length) ||
    content.length > 100_000 ||
    attachments.length > 50
  ) {
    throw new AppError(
      'A queued message requires text or attachments within the upload limits.',
      {
        code: 'INVALID_QUEUE_MESSAGE',
        statusCode: 400,
      },
    );
  }
  return {
    content,
    options: readObjectRecord(input.options) ?? {},
    attachments,
  };
}
function readId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new AppError(
      'A message, session or request id of 1-200 characters is required.',
      {
        code: 'INVALID_QUEUE_ID',
        statusCode: 400,
      },
    );
  }
  return value;
}
function readRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AppError('A positive queue revision is required.', {
      code: 'INVALID_QUEUE_REVISION',
      statusCode: 400,
    });
  }
  return value;
}

/** Used by queue HTTP routes and WebSocket steering; all mutations address one owned, versioned entry. */
export const queuedMessagesService = {
  list(userId: number, sessionId: string): QueuedMessage[] {
    return queuedMessagesDb.list(userId, readId(sessionId));
  },
  enqueue(userId: number, body: Record<string, unknown>): QueuedMessage {
    const id = readId(body.id);
    const sessionId = readId(body.sessionId);
    if (!sessionsDb.getSessionById(sessionId)) {
      throw new AppError('Session was not found.', {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }
    const message = readMessage(body);
    const existing = queuedMessagesDb.get(userId, id);
    if (existing) {
      if (
        existing.sessionId !== sessionId ||
        existing.content !== message.content ||
        JSON.stringify(existing.attachments) !==
          JSON.stringify(message.attachments) ||
        JSON.stringify(existing.options) !== JSON.stringify(message.options)
      )
        conflict();
      return existing;
    }
    return queuedMessagesDb.insert({ id, userId, sessionId, ...message });
  },
  update(
    userId: number,
    id: string,
    body: Record<string, unknown>,
  ): QueuedMessage {
    if (
      !queuedMessagesDb.update({
        userId,
        id: readId(id),
        revision: readRevision(body.revision),
        ...readMessage(body),
      })
    )
      conflict();
    return queuedMessagesDb.get(userId, id)!;
  },
  cancel(userId: number, id: string, revision: unknown): void {
    if (!queuedMessagesDb.cancel(userId, readId(id), readRevision(revision)))
      conflict();
  },
  result(userId: number, requestId: string): QueueSteerResult | null {
    return queuedMessagesDb.operation(userId, readId(requestId));
  },
  async steer(
    userId: number,
    body: Record<string, unknown>,
    send: (input: ProviderSteerInput) => Promise<void>,
  ): Promise<QueueSteerResult> {
    const requestId = readId(body.requestId);
    const messageId = readId(body.messageId);
    const sessionId = readId(body.sessionId);
    const turnToken = readId(body.activeTurnToken);
    const revision = readRevision(body.revision);
    const previous = queuedMessagesDb.operation(userId, requestId);
    if (previous) {
      if (
        previous.messageId !== messageId ||
        previous.sessionId !== sessionId ||
        previous.revision !== revision ||
        previous.turnToken !== turnToken
      )
        conflict();
      return previous;
    }
    const message = queuedMessagesDb.get(userId, messageId);
    if (
      !message ||
      message.sessionId !== sessionId ||
      message.revision !== revision
    )
      conflict();
    if (!queuedMessagesDb.reserveSteer(message, requestId, turnToken))
      conflict();
    let status: 'accepted' | 'rejected' | 'unknown' = 'accepted';
    let error: string | null = null;
    try {
      await send({
        sessionId,
        activeTurnToken: turnToken,
        content: message.content,
        attachments: message.attachments,
        messageId,
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      // Local validation and explicit remote rejection prove the input was not accepted.
      // A transport timeout/exit does not: keep the entry blocked rather than resend it.
      status = cause instanceof AppError ? 'rejected' : 'unknown';
    }
    queuedMessagesDb.finishSteer(message, requestId, status, error);
    return { requestId, messageId, sessionId, status, error };
  },
};
