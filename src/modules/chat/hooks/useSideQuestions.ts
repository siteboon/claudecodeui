/**
 * BTW side questions live beside a session's transcript, in one module-level
 * store shared by every view of that session (another tab, a second render
 * of the same page). The server's list is the truth once it holds a row; a
 * question asked from this tab exists locally before the server stores it,
 * so a local entry survives a history refresh that raced the ask — but only
 * while it is still running.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { SideQuestion, SideQuestionEvent } from '@/shared/types';

type Listener = () => void;

const EMPTY: SideQuestion[] = [];

const sessions = new Map<string, SideQuestion[]>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function getList(sessionId: string): SideQuestion[] {
  return sessions.get(sessionId) ?? EMPTY;
}

function sortByCreatedAt(items: SideQuestion[]): SideQuestion[] {
  return [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function setList(sessionId: string, items: SideQuestion[]): void {
  sessions.set(sessionId, items);
  notify();
}

function upsert(sessionId: string, item: SideQuestion): void {
  const list = getList(sessionId);
  const index = list.findIndex((existing) => existing.id === item.id);
  const next = index === -1 ? sortByCreatedAt([...list, item]) : list.map((existing, i) => (i === index ? item : existing));
  setList(sessionId, next);
}

/**
 * The module-level store itself. Exported directly (rather than only through
 * hooks) so non-React code — `useSessionStore`'s history handling,
 * `useChatRealtimeHandlers`'s socket dispatch — can drive it without a
 * component.
 */
export const sideQuestionStore = {
  /** The server's row wins for every id it holds; a local-only entry is kept while it is still `running` (asked from this tab, not yet stored). */
  replaceForSession(sessionId: string, items: SideQuestion[]): void {
    const existing = getList(sessionId);
    const serverIds = new Set(items.map((item) => item.id));
    const keptLocal = existing.filter((item) => !serverIds.has(item.id) && item.status === 'running');
    setList(sessionId, sortByCreatedAt([...items, ...keptLocal]));
  },

  /** The optimistic pending entry for a question just asked from this tab. */
  begin({
    id,
    sessionId,
    question,
    createdAt,
  }: {
    id: string;
    sessionId: string;
    question: string;
    createdAt: string;
  }): void {
    upsert(sessionId, {
      id,
      sessionId,
      question,
      answer: '',
      status: 'running',
      error: null,
      model: null,
      createdAt,
      finishedAt: null,
    });
  },

  /** Folds one `side_question` wire event into the store. */
  applyEvent(event: SideQuestionEvent): void {
    const list = getList(event.sessionId);
    const index = list.findIndex((item) => item.id === event.sideQuestionId);

    if (event.phase === 'dismissed') {
      sideQuestionStore.remove(event.sideQuestionId);
      return;
    }

    if (event.phase === 'started' || event.phase === 'done') {
      if (event.sideQuestion) upsert(event.sessionId, event.sideQuestion);
      return;
    }

    if (event.phase === 'delta') {
      if (index === -1) return; // ignored for an id this store never saw
      const current = list[index];
      upsert(event.sessionId, { ...current, answer: current.answer + (event.text ?? '') });
      return;
    }

    // event.phase === 'error'
    if (event.sideQuestion) {
      upsert(event.sessionId, event.sideQuestion);
      return;
    }
    if (index === -1) return; // unknown id, no row to mark failed
    const current = list[index];
    upsert(event.sessionId, { ...current, status: 'error', error: event.error ?? null });
  },

  /** Takes one entry out, wherever its session is. */
  remove(id: string): void {
    for (const [sessionId, list] of sessions) {
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) continue;
      const next = list.slice();
      next.splice(index, 1);
      setList(sessionId, next);
      return;
    }
  },

  /** A session's side questions, oldest first; an unknown session reads as empty. */
  forSession(sessionId: string): SideQuestion[] {
    return getList(sessionId);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** A session's side questions, re-rendering only when that session's list actually changes. */
export function useSideQuestions(sessionId: string | null): SideQuestion[] {
  return useSyncExternalStore(sideQuestionStore.subscribe, () =>
    sessionId ? sideQuestionStore.forSession(sessionId) : EMPTY,
  );
}

/**
 * A `crypto.randomUUID` id, or `local_<timestamp>_<random>` when it is
 * missing — browsers only expose it on HTTPS or localhost, and CloudCLI is
 * reached over plain `http://` on the tailnet and LANs. Either form matches
 * the server's `[A-Za-z0-9_-]{1,100}`.
 */
function newSideQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Asks a side question: trims the text, refuses an empty question, a missing
 * session, or a dropped connection (`sendMessage` silently discards a frame
 * sent while the socket is not open, which would otherwise leave the
 * optimistic entry `running` forever), draws the optimistic pending entry,
 * and sends the `chat.btw` frame through the `sendMessage` it was given —
 * the composer's own, never `useWebSocket()` directly, which throws outside
 * a provider and would break the composer's existing tests.
 */
export function useAskSideQuestion(
  sendMessage: (message: unknown) => void,
): (
  sessionId: string | null,
  question: string,
  options?: { model?: string },
  isConnected?: boolean,
) => boolean {
  return useCallback(
    (
      sessionId: string | null,
      question: string,
      options?: { model?: string },
      isConnected = true,
    ): boolean => {
      const trimmed = question.trim();
      if (!trimmed || !sessionId || !isConnected) return false;

      const sideQuestionId = newSideQuestionId();
      const createdAt = new Date().toISOString();
      sideQuestionStore.begin({ id: sideQuestionId, sessionId, question: trimmed, createdAt });

      const frame: Record<string, unknown> = {
        type: 'chat.btw',
        sessionId,
        sideQuestionId,
        question: trimmed,
      };
      if (options?.model) frame.options = { model: options.model };
      sendMessage(frame);
      return true;
    },
    [sendMessage],
  );
}

/** Dismisses a side question: deletes it through the API, then removes it from the store. */
export function useDismissSideQuestion(): (sessionId: string, id: string) => Promise<void> {
  return useCallback(async (sessionId: string, id: string): Promise<void> => {
    await api.providers.dismissSideQuestion(sessionId, id);
    sideQuestionStore.remove(id);
  }, []);
}
