/**
 * A bounded, in-memory trace of what happened to each session's runs.
 *
 * The provider runtimes already narrate their own lifecycle — a run started,
 * a provider session was created, a process was held open for background work,
 * a run ended and why. Until now that narration went only to stdout, which
 * means the only way to answer "what happened to this session?" was to read
 * `~/.pm2/logs/` on the host. That is fine for a post-mortem and useless for
 * the question people actually ask, which is asked from a browser about a
 * session that is running right now.
 *
 * So the same records land here as well, keyed by session, and the diagnostics
 * endpoint reads them back. This is a trace, not a log: it is deliberately
 * lossy, it never touches disk, and it is gone when the process restarts.
 * Anything that must survive a restart belongs in the database instead.
 *
 * Both dimensions are bounded, because a server process here routinely lives
 * for days: the events per session, and the number of sessions remembered at
 * all. Without the second bound a long-lived process accumulates one entry per
 * session it has ever served.
 */

/** One lifecycle record, as the runtime emitted it. */
export type RunLifecycleEvent = {
  /** When the runtime emitted it, in epoch milliseconds. */
  timestamp: number;
  /** The transition: `run_start`, `session_created`, `hold_armed`, `run_end`, … */
  event: string;
  /**
   * The runtime's own payload for this event. Deliberately untyped: each
   * runtime decides what is worth recording about its own transitions, and
   * pinning that down here would mean editing this file for every field a
   * runtime learns to report.
   */
  fields: Record<string, unknown>;
};

/**
 * Enough history to cover a turn and the hold that follows it, which is the
 * span the "is it stuck?" question is asked about. Older records are dropped.
 */
const MAX_EVENTS_PER_SESSION = 50;

/**
 * How many sessions are remembered at once. Sessions are evicted in
 * least-recently-written order, so the ones being asked about — which are by
 * definition the ones still producing events — are the ones retained.
 */
const MAX_TRACKED_SESSIONS = 200;

const eventsBySession = new Map<string, RunLifecycleEvent[]>();

/**
 * Records one lifecycle transition for a session.
 *
 * Called by `logRunLifecycle` in the Claude runtime provider alongside its
 * existing `console.log`, so the service log and this trace never disagree.
 * Events without a session key are dropped rather than bucketed together:
 * a run that has not yet resolved an id belongs to no session anyone can ask
 * about, and a shared "unknown" bucket would evict real sessions.
 */
export function recordRunLifecycleEvent(
  sessionKey: string | null | undefined,
  event: string,
  fields: Record<string, unknown>,
): void {
  if (!sessionKey) {
    return;
  }

  const existing = eventsBySession.get(sessionKey);
  const events = existing ?? [];
  events.push({ timestamp: Date.now(), event, fields });
  if (events.length > MAX_EVENTS_PER_SESSION) {
    events.splice(0, events.length - MAX_EVENTS_PER_SESSION);
  }

  // Re-inserting moves the key to the end of the Map's iteration order, which
  // is what makes the eviction below least-recently-written rather than
  // first-ever-seen.
  eventsBySession.delete(sessionKey);
  eventsBySession.set(sessionKey, events);

  while (eventsBySession.size > MAX_TRACKED_SESSIONS) {
    const oldest = eventsBySession.keys().next();
    if (oldest.done) {
      break;
    }
    eventsBySession.delete(oldest.value);
  }
}

/**
 * The trace for one session, oldest first, or an empty array when nothing was
 * recorded — a session that has not run since the server started, or one whose
 * records have since been evicted. The two are indistinguishable from here,
 * which is why the diagnostics response never reads an empty trace as "nothing
 * happened".
 *
 * Used by the session diagnostics service.
 */
export function readRunLifecycleEvents(sessionKey: string | null | undefined): RunLifecycleEvent[] {
  if (!sessionKey) {
    return [];
  }

  return [...(eventsBySession.get(sessionKey) ?? [])];
}

/** Test-only escape hatch: forgets every session's trace. */
export function clearRunLifecycleLog(): void {
  eventsBySession.clear();
}
