import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import { safeLocalStorage } from '@/modules/chat/utils/chatStorage';

/**
 * Shell-style input history for the composer: ArrowUp in an empty textarea
 * recalls messages previously sent in this chat (newest first), ArrowDown
 * walks forward again and finally restores whatever draft was in the box
 * before recall.
 *
 * History is kept per chat scope — the same session-or-`project:` key drafts
 * use — so recall only ever surfaces what was typed in the conversation being
 * looked at. It is a browser-local convenience (localStorage), deliberately
 * not synced through the preference store: what you retype on one device is
 * rarely what you typed on another, and the transcript already travels.
 */

const STORAGE_KEY = 'chat-input-history';
const MAX_ENTRIES_PER_SCOPE = 100;
/** Scopes beyond this are evicted oldest-written-first, so storage cannot grow with every session ever opened. */
const MAX_SCOPES = 100;

type HistoryStore = Record<string, string[]>;

function readHistoryStore(): HistoryStore {
  const raw = safeLocalStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // An array is the pre-scoped format; scoped recall starts fresh.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const store: HistoryStore = {};
    for (const [scope, entries] of Object.entries(parsed)) {
      if (Array.isArray(entries)) {
        store[scope] = entries.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function readInputHistory(scope: string | null): string[] {
  if (!scope) {
    return [];
  }
  return readHistoryStore()[scope] ?? [];
}

function appendInputHistory(scope: string, text: string): void {
  const store = readHistoryStore();
  const entries = store[scope] ?? [];
  if (entries[entries.length - 1] === text) {
    return;
  }
  // Re-inserting moves the scope to the end of the object's key order, which
  // is what the eviction below treats as most-recently-used.
  delete store[scope];
  store[scope] = [...entries, text].slice(-MAX_ENTRIES_PER_SCOPE);
  const scopes = Object.keys(store);
  for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES))) {
    delete store[stale];
  }
  safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

type UseInputHistoryOptions = {
  /** Must also sync any send-time mirror (inputValueRef) with the new value. */
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** The chat being composed into: a session id, or `project:<id>` before one exists. */
  scope: string | null;
};

type HistoryNav = {
  /** Position in the stored history the box currently shows. */
  index: number;
  /** What was in the box before recall started, restored by ArrowDown past the newest entry. */
  draft: string;
  /** The exact text injected; once the box differs the user has edited and the arrows are theirs again. */
  recalled: string;
};

export function useInputHistory({ setInput, textareaRef, scope }: UseInputHistoryOptions) {
  // A ref, not state: it only changes inside key handlers and must not
  // re-render the composer.
  const navRef = useRef<HistoryNav | null>(null);
  const scopeRef = useRef(scope);

  // A recall position from one chat means nothing in another.
  useEffect(() => {
    scopeRef.current = scope;
    navRef.current = null;
  }, [scope]);

  /**
   * `scopeOverride` is for the one send that outruns the prop: the first
   * message of a brand-new chat allocates its session id mid-submit, and
   * recording under that id puts the message in the history of the session
   * the user is navigated to.
   */
  const recordSentMessage = useCallback((text: string, scopeOverride?: string | null) => {
    navRef.current = null;
    const targetScope = scopeOverride ?? scopeRef.current;
    if (!targetScope || !text.trim()) {
      return;
    }
    appendInputHistory(targetScope, text);
  }, []);

  const recall = useCallback(
    (history: string[], index: number, draft: string) => {
      const recalled = history[index];
      navRef.current = { index, draft, recalled };
      setInput(recalled);
      // The controlled update can leave the caret at its old offset; a
      // recalled message should be ready to extend at its end.
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(recalled.length, recalled.length);
      });
    },
    [setInput, textareaRef],
  );

  /** Returns true when the event drove history recall and needs no further handling. */
  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return false;
      }

      const value = event.currentTarget.value;
      const nav = navRef.current;
      const untouched = nav !== null && value === nav.recalled;

      if (event.key === 'ArrowUp') {
        // Only take over an empty box or an untouched recall — everywhere
        // else ArrowUp keeps its usual meaning (caret movement; the command
        // and mention menus intercept before this handler runs).
        if (value !== '' && !untouched) {
          return false;
        }
        const history = readInputHistory(scopeRef.current);
        if (history.length === 0) {
          return false;
        }
        event.preventDefault();
        if (untouched && nav.index === 0) {
          return true; // already at the oldest entry
        }
        recall(
          history,
          untouched ? nav.index - 1 : history.length - 1,
          untouched ? nav.draft : value,
        );
        return true;
      }

      // ArrowDown only walks forward through an untouched recall.
      if (!untouched) {
        return false;
      }
      event.preventDefault();
      const history = readInputHistory(scopeRef.current);
      if (nav.index >= history.length - 1) {
        const { draft } = nav;
        navRef.current = null;
        setInput(draft);
        return true;
      }
      recall(history, nav.index + 1, nav.draft);
      return true;
    },
    [recall, setInput],
  );

  return { recordSentMessage, handleHistoryKeyDown };
}
