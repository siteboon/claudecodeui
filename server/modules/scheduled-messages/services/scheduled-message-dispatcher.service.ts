import { scheduledMessagesDb, sessionDraftsDb, sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, onRunSettled, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 *
 * Queued messages do not wait for this: they are also dispatched the moment
 * the run that blocked them settles (see `unsubscribeRunSettled` below). The
 * poll remains their safety net for the cases no run-settled event covers —
 * a message queued while nothing was running, or one left behind by a server
 * restart.
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
let unsubscribeRunSettled: (() => void) | null = null;
/**
 * Sessions whose scheduled sends are still going, from this pass or an
 * earlier one. Their next due rows stay pending (and keep their banner) until
 * those sends finish, so they neither overtake nor interrupt them.
 */
const sessionsSending = new Set<string>();

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
  // sessionsSending too: a scheduled turn can complete before its send settles,
  // and the session's next due row would then interrupt this queued turn.
  return chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId) || sessionsSending.has(sessionId);
}

/**
 * Sends every persisted queued turn whose session is currently idle.
 *
 * With a `sessionId`, only that session's queued turn is looked at: a run that
 * settles can only have unblocked its own session.
 */
export async function dispatchQueuedMessages(
  runtime: ProviderRuntimeGateway,
  sessionId?: string,
): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages(sessionId);
  let claimed = 0;

  await Promise.all(candidates.map(async (candidate) => {
    if (isSessionBusy(candidate.sessionId, runtime)) {
      return;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      return;
    }
    claimed += 1;
    await sendClaimedQueuedMessage(candidate, runtime);
  }));

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

/** Whether the message's turn started. */
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
      // The session's current selection, not the one at the limit hit: the
      // run records what it uses back onto the session, which would undo a
      // change the user made while waiting.
      const session = sessionsDb.getSessionById(row.session_id);
      if (session?.model) options.model = session.model;
      if (session?.effort) options.effort = session.effort;
      if (session?.permission_mode) options.permissionMode = session.permission_mode;
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
 * Sends every message whose time has come and returns how many it handled.
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
  const shouldClaim = (row: ScheduledMessageRow) => !waitsForBackgroundWork(row, runtime, now.getTime());
  const due = scheduledMessagesDb.claimDue(now, sessionsSending, shouldClaim);
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Sessions side by side, since a turn can stay open a long time (see
  // runDispatchPass). A session's rows that were due at `now` go one after
  // another in this pass, each claimed only when the earlier send ends, so
  // none is recorded as sent while it still waits and no poll gap opens
  // between them. A turn the user starts meanwhile is still interrupted, as
  // any scheduled send interrupts the active run.
  // shortcut: a session's next row waits for the whole earlier send, background work included (the runtime ends that hold after 30 idle minutes); interrupt instead if timeliness matters more.
  let sent = 0;
  await Promise.all(due.map(async (first) => {
    const sessionId = first.session_id;
    sessionsSending.add(sessionId);
    try {
      // A message the user scheduled takes the session over, like a turn of
      // their own would: the automatic continue after it is dropped.
      let userTookOver = false;
      let row: ScheduledMessageRow | null = first;
      while (row) {
        if (userTookOver && isAutoContinue(row)) {
          recordCancelled(row);
        } else {
          const started = await sendClaimedMessage(row, runtime);
          userTookOver ||= started && !isAutoContinue(row);
        }
        sent += 1;
        row = scheduledMessagesDb.claimNextDue(sessionId, now, shouldClaim);
        if (row) announceScheduledMessagesChanged(sessionId);
      }
    } catch (error) {
      logPassFailure(error);
    } finally {
      sessionsSending.delete(sessionId);
      // A run that settled while this session's sends were going was skipped
      // by the run-settled listener (isSessionBusy), so the queued turn it
      // unblocked goes now instead of waiting for the next poll.
      if (unsubscribeRunSettled) {
        void dispatchQueuedMessages(runtime, sessionId).catch(logPassFailure);
      }
    }
  }));

  return sent;
}

function logPassFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
}

/**
 * One poll's work. A send waits for its whole turn, and a Claude turn that
 * leaves background work running (a Monitor, say) stays open until that work
 * reports back, so passes must not wait on each other: claims are
 * transactional, and a queued turn skips a session that is still busy.
 *
 * Exported so a test can drive overlapping passes.
 */
export function runDispatchPass(runtime: ProviderRuntimeGateway): Promise<void> {
  return Promise.all([
    // First, so a due send that starts a run at once has registered it before
    // the queued pass checks whether that session is busy.
    dispatchDueScheduledMessages(runtime).catch(logPassFailure),
    dispatchQueuedMessages(runtime).catch(logPassFailure),
  ]).then(() => undefined);
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

  // A message queued during a turn is sent as soon as that turn ends. Without
  // this the only sender is the poll above, so the user watches an idle
  // session for up to POLL_INTERVAL_MS before their queued turn starts — the
  // frontend deliberately does not send it ("the VPS dispatcher owns sending",
  // useChatComposerState.ts). `dispatchQueuedMessages` re-checks `isSessionBusy`
  // (which also covers a session whose scheduled sends are still going) and
  // claims transactionally, so racing with the poll is harmless. Scoped to
  // the settled session, so several runs ending together do not each rescan
  // every queued turn.
  unsubscribeRunSettled = onRunSettled((appSessionId) => {
    void dispatchQueuedMessages(runtime, appSessionId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ScheduledMessages] Run-settled dispatch failed', { error: message });
    });
  });

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (unsubscribeRunSettled) {
    unsubscribeRunSettled();
    unsubscribeRunSettled = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
