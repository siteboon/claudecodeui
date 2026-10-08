import { scheduledMessagesDb, queuedMessagesDb } from '@/modules/database/index.js';
import type { ScheduledMessageRow } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { QueuedMessage } from '@/shared/types.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;
// Installed only while the production dispatcher is running; tests can drive one pass explicitly.
let wakeQueue: () => void = () => {};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function sendClaimedQueuedMessage(message: QueuedMessage, runtime: ProviderRuntimeGateway): Promise<void> {
  try {
    const result = await runDetachedChatTurn({ sessionId: message.sessionId, userId: message.userId,
      content: message.content, messageId: message.id, options: { ...message.options, attachments: message.attachments } }, { runtime });
    const busy = !result.started && result.error === 'A run was already in progress for this session.';
    queuedMessagesDb.finish(message, 'dispatching', busy ? 'queued' : result.error ? 'failed' : 'consumed', result.error);
    if (!busy && !result.error) wakeQueue();
  } catch (error) {
    queuedMessagesDb.finish(message, 'dispatching', 'unknown', error instanceof Error ? error.message : String(error));
  }
}

/** A queued turn must wait for foreground and background work to finish. */
function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId);
}

/** Sends at most one FIFO head per idle session. Claimed/failed/unknown entries block later messages. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  let claimed = 0;
  await Promise.all(queuedMessagesDb.heads().map(async (message) => {
    if (isSessionBusy(message.sessionId, runtime) || !queuedMessagesDb.claim(message, 'dispatching')) return;
    claimed += 1;
    await sendClaimedQueuedMessage(message, runtime);
  }));
  return claimed;
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options: readOptions(row.options),
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: true,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      scheduledMessagesDb.markFailed(row.id, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scheduledMessagesDb.markFailed(row.id, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  // Sequentially: a session can only have one run at a time, and two due
  // messages for the same session must not race each other into it.
  for (const row of due) {
    await sendClaimedMessage(row, runtime);
  }

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  // An interrupted RPC/run may already have executed. Do not automatically redeliver after restart.
  queuedMessagesDb.recoverClaims();
  const poll = () => {
    // Scheduled messages retain their sequential due-time behavior. Queue claims
    // independently guard each session, so one long run cannot stall every other FIFO.
    if (!dispatchInFlight) {
      dispatchInFlight = true;
      void dispatchDueScheduledMessages(runtime)
        .catch((error: unknown) => console.error('[ScheduledMessages] Dispatch pass failed', error))
        .finally(() => { dispatchInFlight = false; });
    }
    void dispatchQueuedMessages(runtime)
      .catch((error: unknown) => console.error('[QueuedMessages] Dispatch pass failed', error));
  };
  wakeQueue = () => { if (pollTimer) queueMicrotask(poll); };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  wakeQueue = () => {};
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
