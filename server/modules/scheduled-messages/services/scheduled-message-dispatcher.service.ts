import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
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

let pollTimer: ReturnType<typeof setInterval> | null = null;
// Claims waiting for run registration, including an interrupt's pending abort,
// must be persisted again before shutdown can finish draining and exit.
type WaitingClaim = { row: ScheduledMessageRow; controller: AbortController };
const waitingClaims = new Map<string, WaitingClaim>();
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
  if (!result.started && (result.retryable || result.error === 'A run was already in progress for this session.')) {
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
  if (chatRunRegistry.isDraining()) {
    return 0;
  }
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
  scheduledMessagesDb.markFailed(row.id, reason, row.dispatch_token);
  announceScheduledMessagesChanged(row.session_id);
}

/** Failed restoration retains its durable token for recovery at the next startup. */
function restoreUnstartedClaim(row: ScheduledMessageRow): void {
  try {
    scheduledMessagesDb.releaseClaim(row.id, row.dispatch_token);
    announceScheduledMessagesChanged(row.session_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ScheduledMessages] Failed to release claim; retained for startup recovery', { id: row.id, error: message });
  }
}

async function sendClaimedMessage(
  claim: WaitingClaim,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const { row, controller } = claim;
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
        signal: controller.signal,
        // Registration and this ownership transfer are synchronous. Shutdown
        // may restore only claims whose provider turn has not been registered.
        onStarted: () => {
          if (!scheduledMessagesDb.startClaim(row.id, row.dispatch_token)) {
            waitingClaims.delete(row.id);
            controller.abort();
            throw new Error('The scheduled claim is no longer owned by this dispatcher.');
          }
          row.dispatch_token = null;
          waitingClaims.delete(row.id);
        },
      },
      { runtime },
    );

    // Close already restored this row. A new process may now own it: neither
    // a late abort result nor a rejection may release/fail that process's claim.
    if (controller.signal.aborted) {
      return;
    }
    waitingClaims.delete(row.id);

    // Shutdown is temporary, so an unstarted turn remains pending. Permanent
    // admission failures and errors after a run started remain visible failures:
    // retrying a turn that already ran could repeat its side effects.
    if ((!result.started && result.retryable) || (result.started && row.dispatch_token !== null)) {
      // A failed durable handoff also means the provider never ran. Preserve
      // recovery even though the registry briefly registered that turn.
      restoreUnstartedClaim(row);
    } else if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    waitingClaims.delete(row.id);
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
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
  if (chatRunRegistry.isDraining()) {
    return 0;
  }
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now, sessionsSending);
  if (due.length === 0) {
    return 0;
  }
  for (const row of due) {
    waitingClaims.set(row.id, { row, controller: new AbortController() });
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
      let row: ScheduledMessageRow | null = first;
      while (row) {
        const claim = waitingClaims.get(row.id);
        if (claim?.row !== row) break;
        await sendClaimedMessage(claim, runtime);
        sent += 1;
        // Shutdown revokes unstarted claims. Do not reclaim those rows from
        // the same pass, or take the next row after admission has closed.
        if (claim.controller.signal.aborted || row.dispatch_token !== null || chatRunRegistry.isDraining()) break;
        row = scheduledMessagesDb.claimNextDue(sessionId, now);
        if (row) {
          waitingClaims.set(row.id, { row, controller: new AbortController() });
          announceScheduledMessagesChanged(sessionId);
        }
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
  scheduledMessagesDb.recoverUnstartedClaims();

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

/** Used by server shutdown to stop polling and restore claims that have not started. */
export function closeScheduledMessageDispatcher(): void {
  if (unsubscribeRunSettled) {
    unsubscribeRunSettled();
    unsubscribeRunSettled = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const [id, claim] of waitingClaims) {
    waitingClaims.delete(id);
    // Revoke the admission before touching persistence. A failed write leaves
    // the token available for startup recovery without permitting a late send.
    claim.controller.abort();
    restoreUnstartedClaim(claim.row);
  }
  waitingClaims.clear();
}
