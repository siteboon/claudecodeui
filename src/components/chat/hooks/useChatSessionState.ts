import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { useSettings } from '../../../contexts/SettingsContext';
import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionIdle, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';
import {
  clearSearchHighlights,
  expandCollapsedMatches,
  highlightQueryInElement,
  scrollRangeIntoView,
} from '../utils/inChatHighlight';

import { normalizedToChatMessages } from './useChatMessages';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;
/**
 * How long the "jumping to search result" indicator waits before giving up.
 * Cold sessions are read from disk and lazily loaded, which can take a few
 * seconds on the largest transcripts; beyond this the navigation has failed and
 * a stuck spinner is worse than none.
 */
const SEARCH_NAV_TIMEOUT_MS = 20000;

type SearchTarget = {
  timestamp?: string;
  uuid?: string;
  snippet?: string;
  query?: string;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  processingSessions?: SessionActivityMap;
  onSessionIdle?: MarkSessionIdle;
  resetStreamingState: () => void;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  /** Highest live seq observed per session; sent as `lastSeq` on subscribe. */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  sessionStore: SessionStore;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

/* ------------------------------------------------------------------ */
/*  Helper: Convert a ChatMessage to a NormalizedMessage for the store */
/* ------------------------------------------------------------------ */

function chatMessageToNormalized(
  msg: ChatMessage,
  sessionId: string,
  provider: LLMProvider,
): NormalizedMessage | null {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp instanceof Date
    ? msg.timestamp.toISOString()
    : typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : typeof msg.timestamp === 'string' && !Number.isNaN(Date.parse(msg.timestamp))
        ? msg.timestamp
        : new Date().toISOString();
  const base = { id, sessionId, timestamp: ts, provider };

  if (msg.isToolUse) {
    return {
      ...base,
      kind: 'tool_use',
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolId: msg.toolId || id,
    } as NormalizedMessage;
  }
  if (msg.isThinking) {
    return { ...base, kind: 'thinking', content: msg.content || '' } as NormalizedMessage;
  }
  if (msg.isInteractivePrompt) {
    return { ...base, kind: 'interactive_prompt', content: msg.content || '' } as NormalizedMessage;
  }
  if ((msg as any).isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: (msg as any).taskStatus || 'completed',
      summary: msg.content || '',
    } as NormalizedMessage;
  }
  if (msg.type === 'error') {
    return { ...base, kind: 'error', content: msg.content || '' } as NormalizedMessage;
  }
  return {
    ...base,
    kind: 'text',
    role: msg.type === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Helpers: locating a search hit in the loaded transcript            */
/* ------------------------------------------------------------------ */

/**
 * Does a rendered message's uuid identify the searched transcript entry?
 *
 * Search results carry the bare transcript uuid, while one transcript entry can
 * expand into several messages suffixed `<uuid>_<partIndex>` (see the Claude
 * provider's normalizer), so a prefix comparison is the correct test.
 */
function matchesMessageUuid(messageUuid: unknown, targetUuid: string): boolean {
  if (typeof messageUuid !== 'string' || !messageUuid) return false;
  return messageUuid === targetUuid || messageUuid.startsWith(`${targetUuid}_`);
}

/**
 * Collapse runs of whitespace to single spaces and lowercase, so a server
 * snippet (newlines already flattened) can be compared against rendered
 * `textContent` (newlines and indentation intact).
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Index of the matched message in the loaded array, used to pick the render
 * window. Prefers the exact uuid; falls back to nearest timestamp.
 */
function findTargetMessageIndex(messages: ChatMessage[], target: SearchTarget): number {
  if (target.uuid) {
    const uuid = target.uuid;
    const exactIndex = messages.findIndex((message) => matchesMessageUuid(message.messageUuid, uuid));
    if (exactIndex >= 0) return exactIndex;

    // A hit inside a tool result: that result is folded into its tool_use row,
    // so the row carrying it is the one to window around.
    const resultIndex = messages.findIndex((message) => matchesMessageUuid(message.resultMessageUuid, uuid));
    if (resultIndex >= 0) return resultIndex;
  }

  if (!target.timestamp) return -1;

  const targetDate = new Date(target.timestamp).getTime();
  if (Number.isNaN(targetDate)) return -1;

  let closestDiff = Infinity;
  let closestIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const messageTime = new Date(messages[i].timestamp as string | number).getTime();
    if (Number.isNaN(messageTime)) continue;
    const diff = Math.abs(messageTime - targetDate);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

/**
 * Resolve the rendered element to scroll to, in descending order of precision:
 * exact uuid, collapsed tool group containing that uuid, snippet text, nearest
 * timestamp. `needsExpansion` marks the collapsed-group case, whose children
 * aren't in the DOM until the caller expands it.
 */
function locateTargetElement(
  container: HTMLElement,
  target: SearchTarget,
): { element: HTMLElement; needsExpansion: boolean } | null {
  if (target.uuid) {
    for (const element of container.querySelectorAll('[data-message-uuid]')) {
      if (matchesMessageUuid(element.getAttribute('data-message-uuid'), target.uuid) && element instanceof HTMLElement) {
        return { element, needsExpansion: false };
      }
    }

    // A hit inside a tool result. The result isn't a message of its own — it
    // renders inside the tool_use row that published this attribute.
    for (const element of container.querySelectorAll('[data-result-message-uuid]')) {
      if (matchesMessageUuid(element.getAttribute('data-result-message-uuid'), target.uuid) && element instanceof HTMLElement) {
        return { element, needsExpansion: false };
      }
    }

    for (const element of container.querySelectorAll('[data-group-message-uuids]')) {
      const uuids = (element.getAttribute('data-group-message-uuids') || '').split(' ');
      if (uuids.some((uuid) => matchesMessageUuid(uuid, target.uuid as string)) && element instanceof HTMLElement) {
        return { element, needsExpansion: true };
      }
    }
  }

  // Snippet text. Server snippets strip surrounding "..." and flatten newlines,
  // so only a leading slice is compared, and only when it's long enough to be
  // meaningfully distinctive. Both sides are whitespace-normalized: the snippet
  // collapses the transcript's newlines and indentation to single spaces, while
  // `textContent` preserves whatever the renderer emitted, so a raw comparison
  // misses every match that spans a line break.
  if (target.snippet) {
    const cleanSnippet = target.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '');
    const searchPhrase = normalizeWhitespace(cleanSnippet).slice(0, 80).trim();
    if (searchPhrase.length >= 10) {
      for (const element of container.querySelectorAll('.chat-message')) {
        if (normalizeWhitespace(element.textContent || '').includes(searchPhrase) && element instanceof HTMLElement) {
          return { element, needsExpansion: element.classList.contains('tool') };
        }
      }
    }
  }

  if (target.timestamp) {
    const targetDate = new Date(target.timestamp).getTime();
    if (!Number.isNaN(targetDate)) {
      let closestDiff = Infinity;
      let closest: HTMLElement | null = null;
      for (const element of container.querySelectorAll('[data-message-timestamp]')) {
        const timestamp = element.getAttribute('data-message-timestamp');
        if (!timestamp || !(element instanceof HTMLElement)) continue;
        const elementDate = new Date(timestamp).getTime();
        if (Number.isNaN(elementDate)) continue;
        const diff = Math.abs(elementDate - targetDate);
        if (diff < closestDiff) {
          closestDiff = diff;
          closest = element;
        }
      }
      if (closest) {
        return { element: closest, needsExpansion: closest.classList.contains('tool') };
      }
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  autoScrollToBottom,
  externalMessageUpdate,
  newSessionTrigger,
  processingSessions,
  onSessionIdle,
  resetStreamingState,
  statusCheckSentAtRef,
  lastSeqRef,
  sessionStore,
}: UseChatSessionStateArgs) {
  const { getSetting } = useSettings();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  // Synchronous mirror of isUserScrolledUp. The autoscroll effect runs in the
  // same commit that appends/prepends messages, before the state setter has
  // flushed — so reading the state there sees a stale value and yanks the
  // viewport to the bottom while the user is reading older messages. This ref
  // is written synchronously in the scroll handler and read by that effect.
  const isUserScrolledUpRef = useRef(false);
  // The context window is stamped on the token-budget stream from a synchronous
  // per-model cache, identically on the live and REST paths, so no client-side
  // stickiness is needed — a plain setter suffices.
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [searchWindow, setSearchWindow] = useState<{ start: number; end: number } | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [viewHiddenCount, setViewHiddenCount] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  /**
   * True from the moment a search hit is clicked until it's scrolled into view
   * (or times out). Covers the whole gap — project selection, disk read, lazy
   * load — during which the click otherwise looked like it did nothing.
   */
  const [searchNavPending, setSearchNavPending] = useState(false);
  const searchScrollActiveRef = useRef(false);
  /** Query whose in-chat marks are currently applied, so they can be cleared. */
  const highlightedQueryRef = useRef<string | null>(null);
  /**
   * The target whose navigation has already been launched. The scroll effect
   * re-runs as messages stream in, so this keeps it to one attempt per target
   * without clearing the target itself (which is what made a hit need two or
   * three clicks).
   */
  const startedSearchTargetRef = useRef<SearchTarget | null>(null);
  /**
   * Bumped whenever a navigation is superseded or abandoned. The in-flight async
   * walk compares against it instead of using effect cleanup: the effect's own
   * state writes would re-run it and cancel the navigation it just started.
   */
  const searchNavGenerationRef = useRef(0);
  const searchNavTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /**
   * Reveal (prompt-history ArrowUp/Down) has its own timers/generation, kept
   * separate from search so the two flows can't cancel each other's scroll.
   * `revealFlashedElementRef` holds the element currently wearing the flash
   * class, so a rapid next reveal can strip it before flashing the new target.
   */
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealGenerationRef = useRef(0);
  const revealFlashedElementRef = useRef<HTMLElement | null>(null);
  const _isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedSessionKeyRef = useRef<string | null>(null);
  /**
   * Tracks the last processed value from `useProjectsState.newSessionTrigger`.
   *
   * The trigger itself is intentionally increment-only and routed via:
   * useProjectsState -> AppContent -> MainContent -> ChatInterface -> this hook.
   * We compare values to ensure each explicit New Session click runs exactly one
   * reset pass in this local chat state domain.
   */
  const previousNewSessionTriggerRef = useRef(newSessionTrigger ?? 0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  /**
   * Abandon any in-flight search navigation: invalidate its generation and drop
   * its pending timers, so a superseded jump can't scroll or highlight on top of
   * a newer one.
   */
  const cancelSearchNavigation = useCallback(() => {
    searchNavGenerationRef.current += 1;
    for (const timer of searchNavTimersRef.current) clearTimeout(timer);
    searchNavTimersRef.current = [];
    searchScrollActiveRef.current = false;
    startedSearchTargetRef.current = null;
  }, []);

  useEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === previousNewSessionTriggerRef.current) {
      return;
    }
    previousNewSessionTriggerRef.current = trigger;

    /**
     * Consumer-side reset for explicit New Session intent.
     *
     * Why this is essential:
     * - Chat keeps local state that is not fully derived from `selectedSession`:
     *   `currentSessionId`, `pendingUserMessage`, streaming/status flags, message
     *   pagination/scroll bookkeeping, and provider-specific sessionStorage keys.
     * - If the user clicks New Session while already on the same route with no
     *   selected session, parent state updates can be idempotent and this local
     *   state would otherwise persist, making the click appear to "do nothing".
     *
     * What this reset guarantees:
     * - A deterministic clean draft state on every New Session click.
     * - No dependence on route/tab/session-object identity changes.
     * - No coupling to unrelated external update signals.
     */
    resetStreamingState();
    setCurrentSessionId(null);
    setPendingUserMessage(null);
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    
    setTokenBudget(null);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setViewHiddenCount(0);
    cancelSearchNavigation();
    clearSearchHighlights();
    highlightedQueryRef.current = null;
    setSearchTarget(null);
    setSearchNavPending(false);
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    pendingInitialScrollRef.current = true;
    lastLoadedSessionKeyRef.current = null;

    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }
    if (loadAllFinishedTimerRef.current) {
      clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = null;
    }
  }, [cancelSearchNavigation, newSessionTrigger, onSessionIdle, resetStreamingState]);

  /* ---------------------------------------------------------------- */
  /*  Derive processing state for the viewed session                  */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;

  // The activity indicator always reflects the latest status of the session
  // being viewed — never stale local UI state from the last time it was
  // open. Session ids are concrete before any send, so no pending
  // placeholder entry exists anymore.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null;
  const canAbortSession = isProcessing && sessionActivity.canInterrupt;

  // Ref mirror so effects can read the latest map without re-running on
  // every activity transition.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const flushedPendingUserMessageRef = useRef<ChatMessage | null>(null);

  // Tell the store which session we're viewing so it only re-renders for this one
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionId !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionId;
    sessionStore.setActiveSession(activeSessionId);
  }

  useEffect(() => {
    if (!pendingUserMessage) {
      flushedPendingUserMessageRef.current = null;
      return;
    }

    if (!activeSessionId) {
      return;
    }

    if (flushedPendingUserMessageRef.current === pendingUserMessage) {
      return;
    }

    const prov = (getSetting('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }

    flushedPendingUserMessageRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSessionId, pendingUserMessage, sessionStore, getSetting]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : [];

  // Reset viewHiddenCount when store messages change
  const prevStoreLenRef = useRef(0);
  if (storeMessages.length !== prevStoreLenRef.current) {
    prevStoreLenRef.current = storeMessages.length;
    if (viewHiddenCount > 0) setViewHiddenCount(0);
  }

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    if (viewHiddenCount > 0 && viewHiddenCount < all.length) return all.slice(0, -viewHiddenCount);
    return all;
  }, [storeMessages, viewHiddenCount, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage / clearMessages / rewindMessages                     */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet — show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    const prov = (getSetting('selected-provider') as LLMProvider) || 'claude';
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore, getSetting]);

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return;
    sessionStore.clearRealtime(activeSessionId);
  }, [activeSessionId, sessionStore]);

  const rewindMessages = useCallback((count: number) => setViewHiddenCount(count), []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return false;
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) return false;

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const slot = await sessionStore.fetchMore(selectedSession.id, {
          limit: MESSAGES_PER_PAGE,
        });
        if (!slot || slot.serverMessages.length === 0) return false;

        pendingScrollRestoreRef.current = { height: previousScrollHeight, top: previousScrollTop };
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        setVisibleMessageCount((prev) => prev + MESSAGES_PER_PAGE);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, selectedProject, selectedSession, sessionStore],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom();
    isUserScrolledUpRef.current = !nearBottom;
    setIsUserScrolledUp(!nearBottom);

    if (!allMessagesLoadedRef.current) {
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) { topLoadLockRef.current = false; return; }
      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) topLoadLockRef.current = false;
        return;
      }
      const didLoad = await loadOlderMessages(container);
      if (didLoad) topLoadLockRef.current = true;
    }
  }, [isNearBottom, loadOlderMessages]);

  // Restore the reading position after older messages are prepended.
  //
  // The naive one-shot restore fired against `scrollHeight` at the instant the
  // new rows mounted — but that height is transiently *inflated* while markdown,
  // code highlighting, and images in the prepended messages are still laying
  // out. It then collapses as content reflows, which left the anchor math
  // (top + heightDelta) pointing far below where the user was, yanking them
  // down toward the bottom while they were reading older messages.
  //
  // Mirrors the initial-scroll loop below: re-apply the anchor every animation
  // frame while the height is still settling, capped at ~1s or 3 stable frames.
  // The delta is recomputed each frame from the captured pre-prepend height, so
  // as the height collapses the target tracks down to `heightOfPrependedRows`,
  // keeping the previously-visible messages fixed in place.
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;
    const { height, top } = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    const container = scrollContainerRef.current;

    let frame = 0;
    let lastHeight = 0;
    let stableCount = 0;
    let rafId = 0;

    const anchor = () => {
      if (!scrollContainerRef.current) return;
      container.scrollTop = top + Math.max(container.scrollHeight - height, 0);
      if (container.scrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = container.scrollHeight;
      }
      frame++;
      if (stableCount < 3 && frame < 60) {
        rafId = requestAnimationFrame(anchor);
      }
    };
    anchor();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [chatMessages.length]);

  // Reset scroll/pagination state on session change
  useEffect(() => {
    if (!searchScrollActiveRef.current) {
      pendingInitialScrollRef.current = true;
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
    setSearchWindow(null);
    // Abandon any in-flight prompt-history reveal from the previous session.
    revealGenerationRef.current += 1;
    for (const timer of revealTimersRef.current) clearTimeout(timer);
    revealTimersRef.current = [];
    revealFlashedElementRef.current = null;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    isUserScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
  }, [selectedProject?.projectId, selectedSession?.id]);

  // Initial scroll to bottom — robust to lazy content reflow.
  // The previous implementation fired one scrollToBottom() at +200ms and
  // cleared the pending flag. When markdown blocks, code highlighting, or
  // images finished rendering after that window, scrollHeight grew but
  // nothing re-anchored the viewport, leaving the chat tab visually
  // "scrolled way up" with the latest assistant message off-screen.
  //
  // This version re-scrolls every animation frame while scrollHeight is
  // still growing, capped at ~1s (60 frames) or 3 consecutive stable
  // frames. Cancels cleanly on session change via the pending flag.
  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;
    // Do NOT clear the pending flag on an empty list: the message list is
    // transiently empty while a session's messages load (and again on WS
    // reconnect refreshes). Clearing here permanently disabled the
    // scroll-to-bottom, leaving the session parked at scrollTop 0 with the
    // newest message far below the fold. Just wait — this effect re-runs when
    // chatMessages.length changes, and completes once messages arrive.
    if (chatMessages.length === 0) return;
    if (searchScrollActiveRef.current) { pendingInitialScrollRef.current = false; return; }

    const container = scrollContainerRef.current;
    let frame = 0;
    let lastHeight = 0;
    let stableCount = 0;
    let rafId = 0;

    const tick = () => {
      if (!pendingInitialScrollRef.current || !scrollContainerRef.current) return;
      container.scrollTop = container.scrollHeight;
      if (container.scrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = container.scrollHeight;
      }
      frame++;
      if (stableCount < 3 && frame < 60) {
        rafId = requestAnimationFrame(tick);
      } else {
        pendingInitialScrollRef.current = false;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  // Main session loading effect — store-based
  useEffect(() => {
    if (!selectedSession || !selectedProject) {
      // A freshly created session can be mid-run before the router has a
      // canonical selectedSession (the URL effect synthesizes one on the
      // next render). Keep the active view intact instead of wiping it.
      if (currentSessionId && processingSessionsRef.current?.has(currentSessionId)) {
        return;
      }

      resetStreamingState();
      setCurrentSessionId(null);
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      setTokenBudget(null);
      lastLoadedSessionKeyRef.current = null;
      return;
    }

    const selectedSessionId = selectedSession.id;
    const sessionKey = `${selectedSessionId}:${selectedProject.projectId}`;

    const subscribeToSelectedSession = () => {
      if (!ws) {
        return;
      }

      statusCheckSentAtRef.current.set(selectedSessionId, Date.now());
      sendMessage({
        type: 'chat.subscribe',
        sessions: [{
          sessionId: selectedSessionId,
          lastSeq: lastSeqRef.current.get(selectedSessionId) ?? 0,
        }],
      });
    };

    // Skip if already loaded and fresh
    if (lastLoadedSessionKeyRef.current === sessionKey && sessionStore.has(selectedSessionId) && !sessionStore.isStale(selectedSessionId)) {
      subscribeToSelectedSession();
      return;
    }

    const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSessionId;
    if (sessionChanged) {
      resetStreamingState();
    }

    // Reset pagination/scroll state
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setViewHiddenCount(0);
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);

    if (sessionChanged) {
      setTokenBudget(null);
    }

    setCurrentSessionId(selectedSessionId);

    // Subscribe to the session's live run (if any): the ack reconciles the
    // processing indicator, re-attaches a mid-flight stream to this socket,
    // and replays any live events missed since `lastSeq`. Recording the send
    // time lets the ack handler discard idle acks that a newer request has
    // since outdated.
    subscribeToSelectedSession();

    lastLoadedSessionKeyRef.current = sessionKey;

    // Fetch ALL messages from the server so prompt history (ArrowUp/Down) and
    // message rendering have the full transcript from the start. The per-session
    // message count is bounded enough for a personal-use fork.
    setIsLoadingSessionMessages(true);
    sessionStore.fetchFromServer(selectedSessionId, {
      limit: null,
    }).then(slot => {
      if (slot) {
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        if (slot.tokenUsage) setTokenBudget(slot.tokenUsage as Record<string, unknown>);
      }
      setIsLoadingSessionMessages(false);
    }).catch(() => {
      setIsLoadingSessionMessages(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resetStreamingState,
    selectedProject,
    selectedSession?.id,
    sendMessage,
    statusCheckSentAtRef,
    lastSeqRef,
    ws,
    sessionStore,
  ]);

  // External message update (e.g. WebSocket reconnect, background refresh)
  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) return;

    const reloadExternalMessages = async () => {
      try {
        // Skip store refresh during active streaming
        if (!isProcessing) {
          await sessionStore.refreshFromServer(selectedSession.id);

          if (Boolean(autoScrollToBottom) && isNearBottom()) {
            setTimeout(() => scrollToBottom(), 200);
          }
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isNearBottom,
    scrollToBottom,
    selectedProject,
    selectedSession,
    sessionStore,
    isProcessing,
  ]);

  // Search navigation target.
  //
  // A hit is often in a session the sidebar never lazy-loaded, so this fires
  // long before any messages exist. `searchNavPending` drives the "jumping to
  // your search result" indicator across that whole gap — it can't be derived
  // from `isLoadingSessionMessages`, which stays false until the project is
  // selected and the fetch actually starts.
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    const targetUuid = session?.__searchTargetUuid;
    const query = session?.__searchQuery;

    const hasTarget = (typeof targetSnippet === 'string' && targetSnippet)
      || (typeof targetUuid === 'string' && targetUuid);
    if (!hasTarget) return;

    // Supersede whatever a previously clicked hit still had in flight.
    cancelSearchNavigation();
    searchScrollActiveRef.current = true;
    setSearchNavPending(true);
    setSearchTarget({
      snippet: typeof targetSnippet === 'string' ? targetSnippet : undefined,
      timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      uuid: typeof targetUuid === 'string' ? targetUuid : undefined,
      query: typeof query === 'string' ? query : undefined,
    });
  }, [cancelSearchNavigation, selectedSession]);

  // Give up on the indicator if the session simply never loads, so a failed
  // navigation doesn't leave a spinner up forever.
  useEffect(() => {
    if (!searchNavPending) return;
    const timeout = setTimeout(() => {
      cancelSearchNavigation();
      setSearchNavPending(false);
      setSearchTarget(null);
    }, SEARCH_NAV_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [cancelSearchNavigation, searchNavPending]);

  // Scroll to the search target and highlight the query around it.
  //
  // The target survives until messages are actually in hand. Consuming it up
  // front (as this used to) threw it away whenever the effect ran before
  // hydration — the normal case for a session the sidebar hadn't loaded — which
  // is why the same hit needed two or three clicks. The started-ref keeps the
  // re-runs idempotent instead: the effect fires again as messages arrive, but
  // launches at most one navigation per target.
  useEffect(() => {
    if (!searchTarget || startedSearchTargetRef.current === searchTarget) return;
    if (chatMessages.length === 0 || isLoadingSessionMessages) return;

    startedSearchTargetRef.current = searchTarget;
    const target = searchTarget;

    // Generation guard rather than effect cleanup: `finish()` clears
    // `searchTarget`, which re-runs this effect, so a cleanup-based cancel would
    // abort the very navigation that had just started.
    const generation = ++searchNavGenerationRef.current;
    const isStale = () => searchNavGenerationRef.current !== generation;

    const delay = (ms: number) => new Promise<void>((resolve) => {
      searchNavTimersRef.current.push(setTimeout(resolve, ms));
    });

    // Every exit path runs this, so the "jumping to search result" indicator
    // can't be left spinning after a failed or abandoned jump.
    const finish = () => {
      if (isStale()) return;
      searchScrollActiveRef.current = false;
      setSearchNavPending(false);
      setSearchTarget(null);
    };

    const scrollToTarget = async () => {
      const SEARCH_WINDOW_PADDING = 25;
      const targetIndex = findTargetMessageIndex(chatMessages, target);

      // Render a narrow window around the target rather than the whole
      // transcript — sessions here run to thousands of messages.
      if (targetIndex >= 0) {
        setSearchWindow({
          start: Math.max(0, targetIndex - SEARCH_WINDOW_PADDING),
          end: Math.min(chatMessages.length, targetIndex + SEARCH_WINDOW_PADDING + 1),
        });
      } else {
        setSearchWindow({ start: 0, end: Math.min(chatMessages.length, 50) });
      }

      // Let React commit the windowed slice.
      await delay(80);
      if (isStale()) return;

      const findAndScroll = async (retriesLeft: number): Promise<void> => {
        if (isStale()) return;

        const container = scrollContainerRef.current;
        if (!container) {
          finish();
          return;
        }

        const found = locateTargetElement(container, target);

        if (!found) {
          if (retriesLeft > 0) {
            await delay(150);
            return findAndScroll(retriesLeft - 1);
          }
          finish();
          return;
        }

        // A collapsed tool group keeps its children out of the DOM, so expand it
        // and re-resolve to the specific child message before scrolling.
        let targetElement = found.element;
        if (found.needsExpansion) {
          // `:scope >` so an already-expanded group's nested collapsible triggers
          // can't be mistaken for the group's own toggle.
          const expandBtn = targetElement.querySelector(':scope > button[aria-expanded="false"]');
          if (expandBtn instanceof HTMLElement) {
            expandBtn.click();
            await delay(120);
            if (isStale()) return;
            const expanded = locateTargetElement(container, target);
            if (expanded) targetElement = expanded.element;
          }
        }

        targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        targetElement.classList.add('search-highlight-flash');
        searchNavTimersRef.current.push(
          setTimeout(() => targetElement.classList.remove('search-highlight-flash'), 4000),
        );

        // cmd+F-style highlighting of the term itself, inside the message.
        if (target.query) {
          highlightedQueryRef.current = target.query;

          // Tool parameters and results sit in collapsed sections that clip
          // their contents to zero height, so a match inside one would be
          // highlighted and still invisible. Open them, then wait out the
          // grid-rows transition so ranges measure against settled layout.
          if (expandCollapsedMatches(targetElement, target.query) > 0) {
            await delay(260);
            if (isStale()) return;
          }

          const ranges = highlightQueryInElement(targetElement, target.query);
          if (ranges.length > 0) {
            // Let the message's own smooth scroll settle, then center on the
            // matched text rather than the message: a long tool result can be
            // taller than the viewport, leaving the term offscreen even when its
            // message is "centered".
            await delay(400);
            if (isStale()) return;
            scrollRangeIntoView(ranges[0], container);
          }
        }

        finish();
      };

      await findAndScroll(5);
    };

    void scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  // Drop the term highlights once the user leaves the search context, so stale
  // marks don't linger over an unrelated conversation.
  useEffect(() => {
    if (searchWindow || !highlightedQueryRef.current) return;
    clearSearchHighlights();
    highlightedQueryRef.current = null;
  }, [searchWindow]);

  // Unmount: drop timers and highlights rather than leaving them to fire against
  // a torn-down tree or paint over the next conversation.
  useEffect(() => () => {
    cancelSearchNavigation();
    clearSearchHighlights();
    highlightedQueryRef.current = null;
    revealGenerationRef.current += 1;
    for (const timer of revealTimersRef.current) clearTimeout(timer);
    revealTimersRef.current = [];
    revealFlashedElementRef.current = null;
  }, [cancelSearchNavigation]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const fetchInitialTokenUsage = async () => {
      try {
        // The backend resolves the provider from the indexed session row.
        const url = `/api/projects/${selectedProject.projectId}/sessions/${selectedSession.id}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          setTokenBudget(await response.json());
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id]);

  const visibleMessages = useMemo(() => {
    if (searchWindow) {
      return chatMessages.slice(searchWindow.start, searchWindow.end);
    }

    const total = chatMessages.length;
    if (total <= visibleMessageCount) return chatMessages;

    const overflow = total - visibleMessageCount;
    const dropFromFront = Math.ceil(overflow / MESSAGES_PER_PAGE) * MESSAGES_PER_PAGE;
    return chatMessages.slice(dropFromFront);
  }, [chatMessages, visibleMessageCount, searchWindow]);

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = { height: container.scrollHeight, top: container.scrollTop };
    }
  });

  // Keep the viewport pinned to the newest content while auto-scroll is on.
  //
  // Streaming grows a single assistant message's text *in place*, so
  // `chatMessages.length` does not change and a length-keyed effect never
  // re-fires while the content (and scrollHeight) keeps growing — the bottom
  // drifts out of view until the next message boundary snaps it back, a visible
  // jump on every chunk. A MutationObserver on the scroll container catches all
  // growth (new messages AND in-place token streaming AND late markdown/code
  // reflow), and we pin **synchronously in the mutation callback** so the
  // scrollTop update lands in the same microtask as the DOM change, before the
  // browser paints — no frame is ever shown with the grown content at the wrong
  // offset.
  //
  // `isUserScrolledUpRef` is the live, synchronous read of whether the user has
  // scrolled away from the bottom; if they have, we leave them where they are.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !autoScrollToBottom) return;

    const pin = () => {
      if (!scrollContainerRef.current) return;
      if (isUserScrolledUpRef.current) return;
      if (isLoadingMoreRef.current || pendingScrollRestoreRef.current) return;
      if (searchScrollActiveRef.current) return;
      container.scrollTop = container.scrollHeight;
    };

    const observer = new MutationObserver(pin);
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [autoScrollToBottom]);

  // When auto-scroll is OFF, preserve the user's reading position across appends
  // instead of pinning to the bottom.
  useEffect(() => {
    if (autoScrollToBottom || !scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;
    if (heightDiff > 0 && prevTop > 0) container.scrollTop = prevTop + heightDiff;
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // "Load all" overlay
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => setShowLoadAllOverlay(false), 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => { if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current); };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    setSearchWindow(null);
    const requestSessionId = selectedSession.id;
    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const slot = await sessionStore.fetchFromServer(requestSessionId, {
        limit: null,
        offset: 0,
      });

      if (currentSessionId !== requestSessionId) return;

      if (slot) {
        if (container) {
          pendingScrollRestoreRef.current = { height: previousScrollHeight, top: previousScrollTop };
        }

        setHasMoreMessages(false);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.total;
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => { setLoadAllJustFinished(false); setShowLoadAllOverlay(false); }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore]);

  const dismissSearchWindow = useCallback(() => {
    clearSearchHighlights();
    highlightedQueryRef.current = null;
    setSearchWindow(null);
  }, []);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((prev) => prev + 100);
  }, []);

  /**
   * Scroll a specific transcript message into view and flash it — the same
   * visual as revealing a search hit, but driven by prompt-history ArrowUp/Down
   * rather than a search click. Reuses the search locator/flash primitives, but
   * deliberately skips the search-only UX: no "jumping to result" spinner, no
   * amber window banner, and no cmd+F term highlighting.
   *
   * Unlike search's `searchWindow` (a narrow ±25 slice that hides the rest of
   * the conversation behind a banner), this only ever *grows* the normal render
   * window so the target mounts while the live tail stays put — the recalled
   * text is still editable in the composer, so the conversation shouldn't
   * visibly collapse around it.
   */
  const revealMessage = useCallback(
    (target: { uuid?: string; timestamp?: string | number | Date }) => {
      const uuid = typeof target.uuid === 'string' ? target.uuid : undefined;
      const timestamp =
        target.timestamp === undefined || target.timestamp === null
          ? undefined
          : String(target.timestamp);
      if (!uuid && !timestamp) return;
      const searchTarget: SearchTarget = { uuid, timestamp };

      // Don't scroll on top of an in-flight search jump.
      if (searchScrollActiveRef.current) return;

      // Supersede any previous reveal still retrying/flashing.
      revealGenerationRef.current += 1;
      const generation = revealGenerationRef.current;
      const isStale = () => revealGenerationRef.current !== generation;
      for (const timer of revealTimersRef.current) clearTimeout(timer);
      revealTimersRef.current = [];

      const delay = (ms: number) =>
        new Promise<void>((resolve) => {
          revealTimersRef.current.push(setTimeout(resolve, ms));
        });

      // Grow the render window (never shrink) so an older target mounts while
      // the newest messages stay rendered. Recent recalls are already inside the
      // default window, so this is usually a no-op.
      const targetIndex = findTargetMessageIndex(chatMessages, searchTarget);
      if (targetIndex >= 0 && !searchWindow) {
        const fromEnd = chatMessages.length - targetIndex;
        const needed = fromEnd + MESSAGES_PER_PAGE;
        setVisibleMessageCount((prev) => (needed > prev ? needed : prev));
      }

      const flash = (element: HTMLElement) => {
        if (revealFlashedElementRef.current && revealFlashedElementRef.current !== element) {
          revealFlashedElementRef.current.classList.remove('search-highlight-flash');
        }
        // Restart the animation if this element is flashed again mid-cycle.
        element.classList.remove('search-highlight-flash');
        void element.offsetWidth;
        element.classList.add('search-highlight-flash');
        revealFlashedElementRef.current = element;
        revealTimersRef.current.push(
          setTimeout(() => {
            element.classList.remove('search-highlight-flash');
            if (revealFlashedElementRef.current === element) revealFlashedElementRef.current = null;
          }, 4000),
        );
      };

      const findAndScroll = async (retriesLeft: number): Promise<void> => {
        if (isStale()) return;
        const container = scrollContainerRef.current;
        if (!container) return;

        const found = locateTargetElement(container, searchTarget);
        if (!found) {
          if (retriesLeft > 0) {
            await delay(80);
            return findAndScroll(retriesLeft - 1);
          }
          return;
        }

        found.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flash(found.element);
      };

      // Let a widened window commit before locating the element.
      void (async () => {
        await delay(targetIndex >= 0 && !searchWindow ? 60 : 0);
        if (isStale()) return;
        await findAndScroll(5);
      })();
    },
    [chatMessages, searchWindow],
  );

  return {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    searchWindow,
    searchNavPending,
    dismissSearchWindow,
    revealMessage,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
    handleScroll,
  };
}
