/**
 * When may a finished turn be spoken? The pure core of auto-speak.
 *
 * Built on how frames actually arrive, not on how they look:
 *  - the server replays buffered events only for runs still running, and a
 *    `complete` marks its run finished, so a reload never replays a `complete`;
 *  - `complete` goes to every socket watching the run (a second tab, a phone),
 *    so "this page authored the prompt" is what keeps the other devices quiet;
 *  - `complete` was measured carrying `success: true` on a failed turn whose
 *    outcome came in a separate `error` frame, while `error` frames also carry
 *    ordinary mid-run stderr - so only an error AFTER the last assistant text
 *    counts as the turn's failure;
 *  - `seq` restarts at zero for every run, so dedupe is per run: a lower seq
 *    than the one recorded starts a new run and clears the handled entry.
 *
 * The handler around this (`autoSpeak.ts`) is a thin shell; the "off" check is
 * repeated where the vendor request is made.
 */

export type VoiceFrame = {
  kind?: string;
  sessionId?: string;
  seq?: number;
  role?: unknown;
  aborted?: unknown;
  success?: unknown;
  [key: string]: unknown;
};

export type SpeakContext = {
  /** The `autoSpeak` UI preference. */
  autoSpeak: boolean;
  /** `voiceEnabled` is on and a voice backend is configured. */
  voiceConfigured: boolean;
  /** An `error` frame arrived after the last assistant text of this run. */
  errorAfterLastText: boolean;
  /** This page instance sent (or queued) the prompt now running in the session. */
  authoredByThisPage: boolean;
  /** The session is the one on screen. */
  isActiveView: boolean;
  /** This `complete` (by seq, within the run) was already handled. */
  alreadyHandled: boolean;
};

export type SpeechDecision =
  | { action: 'speak'; reason: 'own_success' }
  | { action: 'cue'; reason: 'own_failure' }
  | {
      action: 'silent';
      reason: 'not_complete' | 'off' | 'duplicate' | 'foreign' | 'not_active' | 'aborted';
    };

export function decideSpeech(frame: VoiceFrame, ctx: SpeakContext): SpeechDecision {
  if (frame.kind !== 'complete') return { action: 'silent', reason: 'not_complete' };
  if (!ctx.autoSpeak || !ctx.voiceConfigured) return { action: 'silent', reason: 'off' };
  if (ctx.alreadyHandled) return { action: 'silent', reason: 'duplicate' };
  if (!ctx.authoredByThisPage) return { action: 'silent', reason: 'foreign' };
  if (!ctx.isActiveView) return { action: 'silent', reason: 'not_active' };
  // The builder's own abort is silent; a server-side failure gets the fixed local cue.
  if (frame.aborted === true) return { action: 'silent', reason: 'aborted' };
  if (frame.success === false || ctx.errorAfterLastText) return { action: 'cue', reason: 'own_failure' };
  return { action: 'speak', reason: 'own_success' };
}

export function shouldSpeak(frame: VoiceFrame, ctx: SpeakContext): boolean {
  return decideSpeech(frame, ctx).action === 'speak';
}

/** How long after a spoken `complete` an `error` for the same session still belongs to that turn. */
export const LATE_ERROR_WINDOW_MS = 3_000;

/**
 * The Claude runtime reports a post-turn error AFTER `complete`, with no second
 * `complete`. Such an error stops playback and switches to the failure cue.
 */
export function isLateError(
  frame: VoiceFrame,
  sessionId: string | null,
  lastSpoken: { sessionId: string; at: number } | null,
  now: number,
  startsNewRun: boolean,
): boolean {
  if (frame.kind !== 'error' || !sessionId || !lastSpoken) return false;
  if (startsNewRun) return false;
  return lastSpoken.sessionId === sessionId && now - lastSpoken.at <= LATE_ERROR_WINDOW_MS;
}

type RunState = {
  lastSeq: number | null;
  handledSeq: number | null;
  errorAfterText: boolean;
  starts: number;
};

const isAssistantText = (frame: VoiceFrame) =>
  frame.kind === 'stream_delta' || (frame.kind === 'text' && frame.role === 'assistant');

/** Per-session run bookkeeping the predicate needs, fed with every live frame. */
export class VoiceRunTracker {
  private runs = new Map<string, RunState>();

  private get(sessionId: string): RunState {
    let state = this.runs.get(sessionId);
    if (!state) {
      state = { lastSeq: null, handledSeq: null, errorAfterText: false, starts: 0 };
      this.runs.set(sessionId, state);
    }
    return state;
  }

  observe(frame: VoiceFrame, sessionId: string | null): { runStarted: boolean } {
    if (!sessionId) return { runStarted: false };
    const state = this.get(sessionId);
    let runStarted = false;

    if (typeof frame.seq === 'number') {
      if (state.lastSeq === null || frame.seq < state.lastSeq) {
        runStarted = true;
        state.starts += 1;
        state.handledSeq = null;
        state.errorAfterText = false;
      }
      state.lastSeq = frame.seq;
    }

    if (isAssistantText(frame)) state.errorAfterText = false;
    else if (frame.kind === 'error') state.errorAfterText = true;

    return { runStarted };
  }

  errorAfterLastText(sessionId: string): boolean {
    return this.runs.get(sessionId)?.errorAfterText ?? false;
  }

  isHandled(sessionId: string, seq: number | undefined): boolean {
    if (typeof seq !== 'number') return false;
    return this.runs.get(sessionId)?.handledSeq === seq;
  }

  markHandled(sessionId: string, seq: number | undefined): void {
    if (typeof seq === 'number') this.get(sessionId).handledSeq = seq;
  }

  /** Called once a `complete` has been decided on. */
  endRun(sessionId: string): void {
    this.get(sessionId).errorAfterText = false;
  }

  /** How many runs this page has seen start in the session (for the draft reconcile). */
  runStarts(sessionId: string): number {
    return this.runs.get(sessionId)?.starts ?? 0;
  }

  reset(): void {
    this.runs.clear();
  }
}
