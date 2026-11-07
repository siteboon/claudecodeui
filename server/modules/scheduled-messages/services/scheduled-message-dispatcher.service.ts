import { scheduledMessagesDb, sessionDraftsDb, sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * How long an automatic continue may wait for background work the stopped
 * turn left running. Past this the conversation has moved on; the CLI stops
 * holding background work after 30 minutes anyway.
 */
const AUTO_CONTINUE_MAX_WAIT_MS = 60 * 60_000;

/**
 * How late an automatic continue may still go out at all, e.g. after the
 * server was down. Past a day the conversation has moved on, the same reason
 * the runtime does not wait out a limit that resets more than a day away.
 */
const AUTO_CONTINUE_MAX_LATE_MS = 24 * 60 * 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Each session's sends still going, from this pass or an earlier one. A send
 * waits for its whole turn, and a Claude turn that leaves background work
 * running stays open until that work reports back (a Monitor never does), so
 * passes must not wait on each other; a queued turn just skips such a session.
 */
const sendsInFlight = new Map<string, Promise<void>>();

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

/**
 * The user's stored tool permissions in the shape the runtime expects. Read
 * more strictly than an interactive send: nobody watches this run, so
 * anything malformed grants nothing.
 */
function readToolsSettings(raw: unknown): { allowedTools: string[]; disallowedTools: string[]; skipPermissions: boolean } {
  const stored = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return {
    allowedTools: strings(stored.allowedTools),
    disallowedTools: strings(stored.disallowedTools),
    skipPermissions: stored.skipPermissions === true,
  };
}

/** For logs: the stack when there is one, so a failure can be traced. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

/**
 * Runs every session's sends side by side and waits for all of them. One
 * session failing is logged as it happens and must neither end the pass early,
 * while another session's turn still runs, nor go unseen. (Scheduled sends
 * record their own failures on the row; this mostly catches queued ones.)
 *
 * With `skipBusy`, a session that still has a send in flight is left for a
 * later pass (its row stays unclaimed). A scheduled send does not wait for
 * one: it interrupts a running turn anyway, and waiting would hold it behind
 * a turn kept open for background work.
 */
async function settleEach(
  sends: { sessionId: string; userId: number; run: () => Promise<void> }[],
  { skipBusy = false }: { skipBusy?: boolean } = {},
): Promise<void> {
  await Promise.all(sends.map(({ sessionId, userId, run }) => {
    if (skipBusy && sendsInFlight.has(sessionId)) {
      return undefined;
    }
    const current: Promise<void> = Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        console.error('[ScheduledMessages] Send failed for one session', { sessionId, userId, error: describeError(error) });
      })
      .finally(() => {
        if (sendsInFlight.get(sessionId) === current) {
          sendsInFlight.delete(sessionId);
        }
      });
    sendsInFlight.set(sessionId, current);
    return current;
  }));
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedChatMessage(candidate.queuedMessage);
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
 * Whether a queued turn has to keep waiting for the session.
 *
 * A turn that ends with background work still going (a backgrounded command,
 * agent or workflow) is marked completed, but its CLI process stays open so
 * that work can report back. A new turn replaces that process and stops the
 * work, which is why the composer asks before an interactive send. A queued
 * turn was promised to go "when this finishes", so it waits for that work too.
 */
function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId);
}

/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  let claimed = 0;

  await settleEach(candidates.map((candidate) => ({
    sessionId: candidate.sessionId,
    userId: candidate.userId,
    run: async () => {
      if (isSessionBusy(candidate.sessionId, runtime)) {
        return;
      }
      if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
        return;
      }
      claimed += 1;
      await sendClaimedQueuedMessage(candidate, runtime);
    },
  })), { skipBusy: true });

  return claimed;
}

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
}

/** An automatic continue dropped quietly; its banner comes down like a failure's. */
function recordCancelled(row: ScheduledMessageRow): void {
  scheduledMessagesDb.markCancelled(row.id);
  announceScheduledMessagesChanged(row.session_id);
}

function isAutoContinue(row: ScheduledMessageRow): boolean {
  return readOptions(row.options).autoContinue === true;
}

/**
 * An automatic continue held back by background work the stopped turn left
 * going. Waits up to a limit; past it the conversation has moved on.
 */
function waitsForBackgroundWork(row: ScheduledMessageRow, runtime: ProviderRuntimeGateway, now: number): boolean {
  return isAutoContinue(row)
    && now - Date.parse(row.scheduled_for) <= AUTO_CONTINUE_MAX_WAIT_MS
    && runtime.hasBackgroundWork(row.session_id);
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<boolean> {
  try {
    const options = readOptions(row.options);
    // The automatic continue after a usage limit is not the user's pick, so it
    // is dropped quietly when auto-continue was turned off for the session
    // since, or when another turn is running (someone took the session over).
    // One over a day late is not sent either, and says so. One waiting for
    // background work the stopped turn left going is only claimed once it has
    // waited too long (see dispatchDueScheduledMessages).
    const autoContinue = options.autoContinue === true;
    if (autoContinue && (
      sessionsDb.getSessionById(row.session_id)?.auto_continue !== 1
      || chatRunRegistry.isProcessing(row.session_id)
    )) {
      recordCancelled(row);
      return false;
    }
    // Measured when this row is reached: earlier rows for the same session may
    // have run for a while. NaN (an unreadable time) counts as too late.
    const late = Date.now() - Date.parse(row.scheduled_for);
    if (autoContinue && !(late <= AUTO_CONTINUE_MAX_LATE_MS)) {
      recordFailure(row, 'Not sent: it was more than a day late, so the conversation had moved on.');
      return false;
    }
    if (autoContinue && runtime.hasBackgroundWork(row.session_id)) {
      if (late > AUTO_CONTINUE_MAX_WAIT_MS) {
        recordFailure(row, `Not sent: the session was still busy with background work ${Math.round(AUTO_CONTINUE_MAX_WAIT_MS / 60_000)} minutes after it was due.`);
      } else {
        // The work started after the claim: a turn of the user's started it,
        // which takes the session over.
        recordCancelled(row);
      }
      return false;
    }
    if (autoContinue) {
      // Unattended, so it needs tool permissions or it stalls on an approval
      // nobody sees: the user's current ones, so revoked ones never run.
      options.toolsSettings = readToolsSettings(userPreferencesDb.getPreferences(row.user_id).claudePermissions);
    }
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options,
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: !autoContinue,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (autoContinue && !result.started && result.error?.includes('already in progress')) {
      // Lost the start to another run: someone took the session over.
      recordCancelled(row);
    } else if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
    return result.started;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ScheduledMessages] Scheduled send failed', {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      error: describeError(error),
    });
    // Never rejects, so a session's later rows still go out.
    try {
      recordFailure(row, message);
    } catch (recordError) {
      console.error('[ScheduledMessages] Could not record a failed send; the message stays marked sent', {
        id: row.id,
        recordError: describeError(recordError),
      });
    }
    return false;
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
  // An automatic continue still waiting for background work the stopped turn
  // left going is not claimed: it stays pending, so a turn the user starts
  // meanwhile drops it, and nothing flickers on every poll. Past the wait
  // limit it is claimed, to be dropped.
  const due = scheduledMessagesDb.claimDue(now, (row) => !waitsForBackgroundWork(row, runtime, now.getTime()));
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Sequentially within a session: it can only have one run at a time, and two
  // due messages for it must not race each other into it. Sessions run side by
  // side, since a send waits for its whole turn and one long turn must not hold
  // back every other session's message (e.g. two sessions continuing after the
  // same usage limit).
  const bySession = new Map<string, ScheduledMessageRow[]>();
  for (const row of due) {
    const rows = bySession.get(row.session_id);
    if (rows) rows.push(row);
    else bySession.set(row.session_id, [row]);
  }
  await settleEach([...bySession].map(([sessionId, rows]) => ({
    sessionId,
    userId: rows[0].user_id,
    run: async () => {
      // A message the user scheduled for this pass takes the session over,
      // like a turn of their own would: the automatic continue after it is dropped.
      let userTookOver = false;
      for (const row of rows) {
        if (userTookOver && isAutoContinue(row)) {
          recordCancelled(row);
          continue;
        }
        const started = await sendClaimedMessage(row, runtime);
        userTookOver ||= started && !isAutoContinue(row);
      }
    },
  })));

  return due.length;
}

/**
 * One poll: claims what is due and starts sending it. Resolves once those
 * sends finish, but the next pass never waits for it: claims are transactional,
 * a session's due rows go one at a time, and a queued turn skips a session
 * with a send in flight, so a long or held-open turn holds back only its own
 * session. The scheduled sends are registered (synchronously, in settleEach)
 * before the queued pass looks, so a queued turn never races a scheduled one
 * for the same session.
 */
export function runDispatchPass(runtime: ProviderRuntimeGateway): Promise<void> {
  const logFailure = (error: unknown) => {
    console.error('[ScheduledMessages] Dispatch pass failed', { error: describeError(error) });
  };
  const scheduled = dispatchDueScheduledMessages(runtime).catch(logFailure);
  const queued = dispatchQueuedMessages(runtime).catch(logFailure);
  return Promise.all([scheduled, queued]).then(() => undefined);
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

  const poll = () => {
    void runDispatchPass(runtime);
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
