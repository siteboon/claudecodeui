import { getHeldSession } from '@/modules/providers/list/claude/claude-held-session.js';
import {
  getPendingApprovalsForSession,
  isClaudeSDKSessionActive,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import {
  readRunLifecycleEvents,
  type RunLifecycleEvent,
} from '@/modules/providers/services/run-lifecycle-log.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * One session's answer to "what is this doing right now?".
 *
 * Every field here was, at least once, worked out by hand: reading pm2 logs,
 * walking process trees, comparing `mtime`s under `/tmp`, querying sqlite. The
 * server knew all of it the whole time; nothing was exposed. This assembles
 * the same picture from what is already in memory, so the question can be
 * answered from the browser in one request instead of an investigation.
 *
 * It reads live state only. Nothing here survives a server restart, and a
 * session that has not run since the process started reports empty — which is
 * itself an answer ("nothing of this session is in this process"), and is not
 * the same as "this session did nothing".
 */

/** What the run registry knows about the turn currently or most recently served. */
type RunDiagnostics = {
  status: 'running' | 'completed';
  provider: LLMProvider;
  providerSessionId: string | null;
  startedAt: number;
  completedAt: number | null;
  /** Elapsed time for a running turn, total duration for a finished one. */
  elapsedMs: number;
  /** Events streamed so far; a client that has fewer has fallen behind. */
  lastSeq: number;
};

/** What the process kept for this conversation is doing between turns. */
type HeldProcessDiagnostics = {
  /** True while a turn is being served on this process right now. */
  busy: boolean;
  /** Background work from the last turn that has not reported back yet. */
  outstandingWork: boolean;
  /** Work that repeats by design — a cron, an armed Monitor — so silence means nothing. */
  recurring: boolean;
  /** When this process last emitted anything at all, or null if it never has. */
  lastMessageAt: number | null;
  /** When the post-turn hold was armed, or null when no hold is running. */
  holdArmedAt: number | null;
  /**
   * Time left on each of the two limits that bound the hold, or null when no
   * hold is running. A negative value means the limit is past due and the
   * timer has not fired yet — worth seeing rather than clamping away.
   */
  idleReleaseInMs: number | null;
  totalReleaseInMs: number | null;
  /** What the CLI was started with, which is what decides whether it can be reused. */
  fingerprint: Record<string, unknown> | null;
};

/** One tool call the run is blocked on, waiting for the user to answer. */
type PendingApprovalDiagnostics = {
  requestId: string;
  toolName: string;
  receivedAt: number | null;
};

export type SessionDiagnostics = {
  sessionId: string;
  /** When this snapshot was taken, so every relative figure in it has an origin. */
  observedAt: number;
  run: RunDiagnostics | null;
  /** True when the provider still holds an SDK query for this session. */
  providerSessionActive: boolean;
  heldProcess: HeldProcessDiagnostics | null;
  /**
   * Whether the last run was started with the setting that keeps one process
   * across the turns of a conversation, or null when no run of this session is
   * in the trace. It lives in the browser's localStorage and is recorded
   * nowhere else, yet it decides whether background work survives the next
   * message — so a missing hold is only surprising when this was on.
   */
  keepSessionAlive: boolean | null;
  pendingApprovals: PendingApprovalDiagnostics[];
  lifecycle: RunLifecycleEvent[];
};

/** Milliseconds left on a deadline that started at `startedAt` and lasts `limitMs`. */
function remainingMs(startedAt: number | null, limitMs: number | null, now: number): number | null {
  if (!startedAt || !limitMs) {
    return null;
  }

  return startedAt + limitMs - now;
}

/**
 * `keepSessionAlive` as the most recent run of this session was started with.
 *
 * Read back out of the trace rather than tracked separately: the setting
 * arrives per turn and belongs to the run that carried it, so the run's own
 * record is where it stays true.
 */
function readKeepSessionAlive(lifecycle: RunLifecycleEvent[]): boolean | null {
  for (let index = lifecycle.length - 1; index >= 0; index -= 1) {
    const event = lifecycle[index];
    if (event.event === 'run_start' && typeof event.fields.keepSessionAlive === 'boolean') {
      return event.fields.keepSessionAlive;
    }
  }

  return null;
}

export const sessionDiagnosticsService = {
  /**
   * Assembles the live picture of one session. Used by the providers route.
   *
   * Never throws for an unknown session: "nothing is running for this id" is a
   * legitimate and common answer, and the caller cannot tell a mistyped id from
   * a session that finished an hour ago anyway.
   */
  getSessionDiagnostics(sessionId: string): SessionDiagnostics {
    const now = Date.now();
    const run = chatRunRegistry.getRun(sessionId);
    const held = getHeldSession(sessionId);
    const lifecycle = readRunLifecycleEvents(sessionId);

    return {
      sessionId,
      observedAt: now,
      run: run
        ? {
          status: run.status,
          provider: run.provider,
          providerSessionId: run.providerSessionId,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          elapsedMs: (run.completedAt ?? now) - run.startedAt,
          lastSeq: run.lastSeq,
        }
        : null,
      providerSessionActive: Boolean(isClaudeSDKSessionActive(sessionId)),
      heldProcess: held
        ? {
          busy: held.busy,
          outstandingWork: held.outstandingWork,
          recurring: held.recurring,
          lastMessageAt: held.lastMessageAt,
          holdArmedAt: held.holdArmedAt,
          // The idle limit is measured from the last thing the process said,
          // falling back to the moment the hold was armed when it has said
          // nothing since — which is the case that matters most.
          idleReleaseInMs: remainingMs(
            held.lastMessageAt ?? held.holdCountdownStartedAt,
            held.holdIdleMs,
            now,
          ),
          totalReleaseInMs: remainingMs(held.holdCountdownStartedAt, held.holdTotalMs, now),
          fingerprint: held.fingerprint ?? null,
        }
        : null,
      keepSessionAlive: readKeepSessionAlive(lifecycle),
      pendingApprovals: getPendingApprovalsForSession(sessionId).map((approval) => ({
        requestId: approval.requestId,
        toolName: approval.toolName,
        receivedAt: approval.receivedAt ? new Date(approval.receivedAt).getTime() : null,
      })),
      lifecycle,
    };
  },
};
