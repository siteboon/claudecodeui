/**
 * Dictation helpers: which composer scope a recording belongs to, and how a
 * transcript joins text already typed.
 *
 * A recording is bound to the session scope that was open when it STARTED. The
 * composer registers its current draft scope on every render; the recorder
 * takes a snapshot at start and hands it back with the transcript, so a builder
 * who switched session while transcribing finds the text in the conversation
 * they dictated it for - and nothing lands in, or is sent to, the other one.
 */

let currentScope: string | null = null;

export function registerComposerScope(scope: string | null | undefined): void {
  currentScope = scope ?? null;
}

/** Snapshot at recording start. */
export function currentDictationScope(): string | null {
  return currentScope;
}

/** Appends a transcript to the END of what the composer holds; typed text is never overwritten. */
export function appendTranscript(base: string, text: string): string {
  const addition = text.trim();
  if (!addition) return base;
  if (!base.trim()) return addition;
  return /\s$/.test(base) ? `${base}${addition}` : `${base} ${addition}`;
}

/** A recording stops by itself after this long (R3). */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** `m:ss` for the visible recording indicator. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
