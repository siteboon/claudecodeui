import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and the due lookup is
 * indexed on `(status, scheduled_for)`, so the poll is one cheap query.
 * Anything finer would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * The last turn the dispatcher started or lined up for each session, cleared
 * once it settles.
 *
 * This is what keeps a session's own messages from overlapping, per session
 * rather than server-wide. A detached turn can stay open for as long as it
 * likes: a Claude permission prompt waits for an answer instead of timing out,
 * and nobody is watching a scheduled or queued run. Holding one global gate
 * across whole runs meant such a turn stopped every other session's scheduled
 * and queued messages until someone answered it.
 *
 * Nothing is claimed and then left waiting in memory, where it could no longer
 * be seen, cancelled or edited, and where a restart would lose it. A session
 * with an entry here is busy for later polls: its scheduled messages that come
 * due stay pending and its queued turn stays in the draft. A scheduled message
 * lined up behind the session's turn within one poll is claimed only when its
 * own turn comes (see startDueScheduledMessages).
 */
const sessionTurnTails = new Map<string, Promise<void>>();

/**
 * Sends a turn after whatever the dispatcher already has going for its
 * session, or straight away when that session has nothing in flight.
 *
 * The tail is recorded synchronously, so the rest of the same pass already
 * sees the session as taken.
 */
function sendInSessionOrder(sessionId: string, send: () => Promise<void>): Promise<void> {
  const previous = sessionTurnTails.get(sessionId);
  // A failed predecessor must not strand the turns lined up behind it.
  const turn = previous ? previous.then(send, send) : send();
  sessionTurnTails.set(sessionId, turn);
  const forget = () => {
    if (sessionTurnTails.get(sessionId) === turn) {
      sessionTurnTails.delete(sessionId);
    }
  };
  turn.then(forget, forget);
  return turn;
}

type StoredQueuedMessage = {
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
};

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

function readQueuedMessage(value: unknown): StoredQueuedMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : Array.isArray(record.images)
      ? record.images
      : [];
  if (!content.trim() && attachments.length === 0) {
    return null;
  }
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
    ? record.options as Record<string, unknown>
    : {};
  return { content, options, attachments };
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: candidate.sessionId,
      userId: candidate.userId,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
    },
    { runtime },
  );

  // The registry check and run reservation are separate operations. If a run
  // wins that tiny race, put the turn back so the next poll tries again.
  if (!result.started && result.error === 'A run was already in progress for this session.') {
    sessionDraftsDb.restoreQueuedMessage(candidate);
    return;
  }
  sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}

/**
 * Claims and starts every persisted queued turn whose session is idle, without
 * waiting for the runs. Returns one promise per turn that settles with its run.
 */
function startQueuedMessages(runtime: ProviderRuntimeGateway): Promise<void>[] {
  const turns: Promise<void>[] = [];

  for (const candidate of sessionDraftsDb.listQueuedMessages()) {
    // A session the dispatcher is still sending to counts as busy too, even
    // when no run is registered (between two lined-up turns, or while a stopped
    // turn winds down). Claiming the turn now would take it out of the draft
    // only to leave it waiting in memory behind that turn.
    if (chatRunRegistry.isProcessing(candidate.sessionId) || sessionTurnTails.has(candidate.sessionId)) {
      continue;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      continue;
    }
    turns.push(sendInSessionOrder(candidate.sessionId, () => sendClaimedQueuedMessage(candidate, runtime)));
  }

  return turns;
}

/**
 * Sends every persisted queued turn whose session is currently idle and waits
 * for those runs.
 *
 * Exported so a test can drive one pass; the poll starts the turns without
 * waiting on them.
 */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const turns = startQueuedMessages(runtime);
  await Promise.all(turns);
  return turns.length;
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
 * Starts sending every message whose time has come, without waiting for the
 * runs. Returns one promise per message that settles with its run.
 */
function startDueScheduledMessages(runtime: ProviderRuntimeGateway, now: Date): Promise<void>[] {
  // Sessions the dispatcher is still sending to are skipped; their messages
  // stay pending until a later poll. Without this, every poll during a long
  // wait would line the same message up behind that session's turn once more.
  const due = scheduledMessagesDb.listDue(now, new Set(sessionTurnTails.keys()));

  // In session order: a session can only have one run at a time, and two due
  // messages for the same session must not race each other into it. Different
  // sessions go side by side, so one that is stuck cannot hold up the rest.
  return due.map((row) => sendInSessionOrder(row.session_id, async () => {
    // Claimed only when its turn comes, which for the first message of a
    // session is straight away. One lined up behind an earlier turn that is
    // still waiting (an unanswered permission prompt) stays pending until
    // then: listed, cancellable, and kept across a restart. A claim that
    // fails means it was cancelled meanwhile, so it is skipped.
    if (scheduledMessagesDb.claim(row.id)) {
      await sendClaimedMessage(row, runtime);
    }
  }));
}

/**
 * Sends every message whose time has come and waits for those runs.
 *
 * Exported so a test can drive one pass without waiting on the timer; the poll
 * starts the runs without waiting on them.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  const turns = startDueScheduledMessages(runtime, now);
  await Promise.all(turns);
  return turns.length;
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

  const reportFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
  };

  const poll = () => {
    // A pass only claims and starts turns; it never waits for them, so a turn
    // that stays open (an unanswered permission prompt waits indefinitely)
    // holds up its own session and nothing else. Overlap within a session is
    // ruled out by sendInSessionOrder, and each claim is atomic.
    // Scheduled messages start first because they are due at a time the user
    // picked: a queued turn for the same session then finds the session taken
    // and waits for a later poll. The other way round, the due message would
    // wait behind the queued turn for as long as that turn stays open.
    try {
      const turns = [
        ...startDueScheduledMessages(runtime, new Date()),
        ...startQueuedMessages(runtime),
      ];
      void Promise.all(turns).catch(reportFailure);
    } catch (error) {
      reportFailure(error);
    }
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
