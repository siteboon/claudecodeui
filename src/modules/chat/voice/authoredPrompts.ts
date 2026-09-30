/**
 * Which running prompts did THIS page instance author?
 *
 * `chat.send` carries no client run token and queued drafts are dispatched by
 * the server, so authorship is a per-session count kept in module memory:
 *  - +1 at the one `chat.send` call site and when this page queues a draft;
 *  - -1 when this page edits or deletes its queued draft, or the draft
 *    reconcile finds it gone with no run started (removed on another device) -
 *    a withdrawn draft must not leave a count behind that a scheduled or CLI
 *    turn would then spend;
 *  - consumed on the session's `complete`.
 *
 * Module memory on purpose: a reload starts from zero, which is exactly why a
 * reload during a running turn stays silent. A second tab or a phone has its
 * own module and never counts this page's prompts.
 */

const counts = new Map<string, number>();
/** Drafts this page queued: the run-start count seen at queue time. */
const queuedDrafts = new Map<string, { runStartsAtQueue: number }>();

type SessionId = string | null | undefined;

const add = (sessionId: string, delta: number) => {
  const next = Math.max(0, (counts.get(sessionId) ?? 0) + delta);
  if (next === 0) counts.delete(sessionId);
  else counts.set(sessionId, next);
};

export function notePromptSent(sessionId: SessionId): void {
  if (sessionId) add(sessionId, 1);
}

/** A draft queued (or updated) by this page while a turn runs. */
export function noteDraftQueued(sessionId: SessionId, runStartsNow: number): void {
  if (!sessionId) return;
  const existing = queuedDrafts.get(sessionId);
  // Updating the same queued draft is not a second prompt. A marker from before a
  // run started belongs to a draft the server already dispatched.
  if (existing && runStartsNow <= existing.runStartsAtQueue) return;
  queuedDrafts.set(sessionId, { runStartsAtQueue: runStartsNow });
  add(sessionId, 1);
}

/** This page edited its queued draft back into the composer, or deleted it. */
export function withdrawDraft(sessionId: SessionId): void {
  if (!sessionId || !queuedDrafts.has(sessionId)) return;
  queuedDrafts.delete(sessionId);
  add(sessionId, -1);
}

/**
 * The draft reconcile found the queued draft gone. If a run started since it
 * was queued, the server dispatched it and the count stays; otherwise it was
 * removed elsewhere and the count is withdrawn.
 */
export function reconcileDraftGone(sessionId: SessionId, runStartsNow: number): void {
  if (!sessionId) return;
  const draft = queuedDrafts.get(sessionId);
  if (!draft) return;
  queuedDrafts.delete(sessionId);
  if (runStartsNow <= draft.runStartsAtQueue) add(sessionId, -1);
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

export function resetAuthoredPrompts(): void {
  counts.clear();
  queuedDrafts.clear();
}
