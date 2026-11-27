import { scheduledMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type { ScheduledMessageRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

/** How far ahead a message may be scheduled. Beyond this it is almost certainly a mistake. */
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CONTENT_LENGTH = 100_000;

export type ScheduledMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  scheduledFor: string;
  status: ScheduledMessageRow['status'];
  failureReason: string | null;
  createdAt: string;
};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // A corrupt options blob must not stop the message from being sent.
    return {};
  }
}

/**
 * Tells every open chat socket that one session's scheduled messages changed,
 * so a composer showing that session's banner reads the list again.
 *
 * Called on every change: scheduled, cancelled, sent and failed. Without it the
 * banner was only read when the session was opened, so a message the
 * dispatcher had sent stayed on screen as still scheduled until a reload, and
 * so did one scheduled or cancelled in another tab or on another device.
 *
 * The frame names the session and nothing else. Each client reads the list
 * again through the authenticated per-user GET, so no message content travels
 * over the broadcast, and a client showing another session ignores it.
 *
 * Exported for this module's dispatcher, which sends and fails messages from a
 * timer with no request to answer. Never throws: the dispatcher calls it right
 * after claiming messages it still has to send.
 */
export function announceScheduledMessagesChanged(sessionId: string): void {
  const frame = JSON.stringify({
    kind: 'scheduled_messages_changed',
    sessionId,
    timestamp: new Date().toISOString(),
  });

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) {
      return;
    }
    try {
      client.send(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ScheduledMessages] Failed to announce a change', { sessionId, error: message });
    }
  });
}

/** `autoContinue` marks the server's own continue after a usage limit; clients cannot claim it. */
function withoutAutoContinue(options: unknown): unknown {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return options ?? {};
  }
  const { autoContinue: _autoContinue, ...rest } = options as Record<string, unknown>;
  return rest;
}

export function toScheduledMessage(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    options: readOptions(row.options),
    scheduledFor: row.scheduled_for,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export const scheduledMessagesService = {
  /**
   * Records a message to send to a session later.
   *
   * The time is taken as an absolute instant, so the schedule does not move if
   * the user changes time zone — or schedules from a phone and is on a laptop
   * when it fires.
   */
  schedule(input: {
    userId: number;
    sessionId: string;
    content: string;
    options?: unknown;
    scheduledFor: string;
  }): ScheduledMessage {
    const content = input.content.trim();
    if (!content) {
      throw new AppError('A scheduled message needs some text.', {
        code: 'CONTENT_REQUIRED',
        statusCode: 400,
      });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new AppError('That message is too long to schedule.', {
        code: 'CONTENT_TOO_LONG',
        statusCode: 400,
      });
    }

    const scheduledFor = new Date(input.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new AppError('scheduledFor must be an ISO timestamp.', {
        code: 'INVALID_SCHEDULE_TIME',
        statusCode: 400,
      });
    }
    if (scheduledFor.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_MS) {
      throw new AppError('That is too far in the future to schedule.', {
        code: 'SCHEDULE_TOO_FAR_AHEAD',
        statusCode: 400,
      });
    }

    if (!sessionsDb.getSessionById(input.sessionId)) {
      throw new AppError(`Session "${input.sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const scheduled = toScheduledMessage(scheduledMessagesDb.create({
      userId: input.userId,
      sessionId: input.sessionId,
      content,
      options: withoutAutoContinue(input.options),
      scheduledFor,
    }));
    announceScheduledMessagesChanged(scheduled.sessionId);
    return scheduled;
  },

  listForSession(userId: number, sessionId: string): ScheduledMessage[] {
    return scheduledMessagesDb.listForSession(userId, sessionId).map(toScheduledMessage);
  },

  listPending(userId: number): ScheduledMessage[] {
    return scheduledMessagesDb.listPendingForUser(userId).map(toScheduledMessage);
  },

  /** Cancels a pending message, or dismisses a failed one. */
  cancel(userId: number, id: string): void {
    const sessionId = scheduledMessagesDb.cancel(userId, id);
    if (!sessionId) {
      throw new AppError('That message has already been sent or cancelled.', {
        code: 'SCHEDULED_MESSAGE_NOT_PENDING',
        statusCode: 409,
      });
    }
    announceScheduledMessagesChanged(sessionId);
  },
};
