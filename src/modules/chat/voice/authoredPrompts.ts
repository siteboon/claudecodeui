/**
 * Which running prompts did THIS page instance author?
 *
 * `chat.send` carries no client run token and queued drafts are dispatched by
 * the server, so authorship is a per-session count kept in module memory:
 *  - +1 at the one `chat.send` call site; -1 again if the server rejects that
 *    send (`protocol_error`: the run never starts, so no `complete` would spend it);
 *  - a draft this page queues is ARMED at queue time and counted when the next
 *    run starts in that session - the server dispatches it only after the running
 *    turn ends. Counting it at queue time let a turn started elsewhere (a phone,
 *    a schedule) spend the draft's count and be spoken, while the draft's own
 *    reply stayed silent;
 *  - editing or deleting the draft here disarms it; the draft reconcile finding
 *    it gone disarms it unless a run starts within a short grace (the claim can
 *    disappear a moment before the dispatched run's first frame arrives);
 *  - consumed on the session's `complete`.
 *
 * Module memory on purpose: a reload starts from zero, which is exactly why a
 * reload during a running turn stays silent. A second tab or a phone has its
 * own module and never counts this page's prompts.
 */

const counts = new Map<string, number>();
/** Drafts this page queued and not yet seen dispatched. */
const armedDrafts = new Map<string, { goneAt: number | null }>();

/** How long after the reconcile saw a draft disappear its run may still start. */
export const DRAFT_DISPATCH_GRACE_MS = 10_000;

type SessionId = string | null | undefined;

const add = (sessionId: string, delta: number) => {
  const next = Math.max(0, (counts.get(sessionId) ?? 0) + delta);
  if (next === 0) counts.delete(sessionId);
  else counts.set(sessionId, next);
};

export function notePromptSent(sessionId: SessionId): void {
  if (sessionId) add(sessionId, 1);
}

/** The server refused a send from this page: that run never starts. */
export function withdrawPrompt(sessionId: SessionId): void {
  if (sessionId) add(sessionId, -1);
}

/** A draft queued (or updated) by this page while a turn runs. */
export function noteDraftQueued(sessionId: SessionId): void {
  if (sessionId) armedDrafts.set(sessionId, { goneAt: null });
}

/** This page edited its queued draft back into the composer, or deleted it. */
export function withdrawDraft(sessionId: SessionId): void {
  if (sessionId) armedDrafts.delete(sessionId);
}

/** The draft reconcile found the queued draft gone from the server's queue. */
export function reconcileDraftGone(sessionId: SessionId, now: number): void {
  const draft = sessionId ? armedDrafts.get(sessionId) : undefined;
  if (draft && draft.goneAt === null) draft.goneAt = now;
}

/** A new run started in the session: if it is this page's dispatched draft, count it. */
export function noteRunStarted(sessionId: SessionId, now: number): void {
  if (!sessionId) return;
  const draft = armedDrafts.get(sessionId);
  if (!draft) return;
  armedDrafts.delete(sessionId);
  if (draft.goneAt === null || now - draft.goneAt <= DRAFT_DISPATCH_GRACE_MS) add(sessionId, 1);
}

/** On the session's `complete`: did this page author the run that just ended? */
export function consumeAuthored(sessionId: SessionId): boolean {
  if (!sessionId) return false;
  const count = counts.get(sessionId) ?? 0;
  if (count <= 0) return false;
  add(sessionId, -1);
  return true;
}

export function authoredCount(sessionId: SessionId): number {
  return sessionId ? counts.get(sessionId) ?? 0 : 0;
}

export function isDraftArmed(sessionId: SessionId): boolean {
  return Boolean(sessionId && armedDrafts.has(sessionId));
}

export function resetAuthoredPrompts(): void {
  counts.clear();
  armedDrafts.clear();
}
