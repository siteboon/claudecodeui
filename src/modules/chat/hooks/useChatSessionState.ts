import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api } from '@/shared/api';
import type { MarkSessionIdle, SessionActivityMap,Project,ProjectSession,LLMProvider,NormalizedMessage,ChatMessage,DiffCalculator } from '@/shared/types';
import type { SessionSlot, SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { SESSION_MESSAGES_PAGE_SIZE } from '@/modules/chat/utils/sessionMessagePagination';
import { createMessageHistoryRefreshCoordinator } from '@/modules/chat/utils/messageHistoryRefreshCoordinator';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { noteProgrammaticScroll } from '@/modules/chat/hooks/useLazyRowObserver';
import { findSearchTargetIndex, resolveSearchWindowSize } from '@/modules/chat/utils/searchTargetLocator';
import { readSelectedProvider } from '@/shared/selectedProvider';
import type { SearchTarget } from '@/modules/chat/utils/searchTargetLocator';

const INITIAL_VISIBLE_MESSAGES = 100;

/** Messages kept below a search hit so it lands mid-viewport rather than at the edge. */
const SEARCH_TARGET_CONTEXT_MESSAGES = 20;

/**
 * Widening the window can commit thousands of rows on an old hit, each running
 * the markdown pipeline, so the scroll waits about three seconds for that render
 * — the same budget the previous DOM scan used.
 */
const SEARCH_SCROLL_RETRIES = 20;
const SEARCH_SCROLL_RETRY_DELAY_MS = 150;

/** Frames a jumped-to row is kept centred while the rows around it mount and settle. */
const CENTER_SETTLE_FRAMES = 20;

/** Consecutive frames the row must stay put for the re-centring to end early. */
const CENTER_STABLE_FRAMES = 3;

/**
 * How long a jumped-to row keeps its highlight class at most, counted from
 * the jump. The flash (the 4s `search-flash` animation in index.css) is held
 * back while the row is a placeholder and plays once it mounts, which can be
 * seconds after the jump; the class normally goes when the flash ends. This
 * takes it off a row that never mounted, and also cuts short the flash of a
 * row that mounted more than ROW_FLASH_MAX_MS minus 4s after the jump, which
 * then plays only for what is left of this.
 */
const ROW_FLASH_MAX_MS = 10_000;

/** Input that means the user is scrolling on their own, which ends a jump: its lookup or its re-centring. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Makes one scrollTop write to the transcript (`write`) and, when it moved the
 * view, tells the manual scroll anchoring the position is the writer's
 * (noteProgrammaticScroll), which retakes its anchor where the write landed.
 * A write that lands where the view already was is not passed on: the layout
 * may already hold a change above the view the anchoring has not corrected
 * yet, and a retake there would make it the new baseline.
 */
function writeTranscriptScroll(container: HTMLElement, write: () => void): void {
  const previousTop = container.scrollTop;
  write();
  if (container.scrollTop !== previousTop) noteProgrammaticScroll(container);
}

/**
 * Starts a jump (a search hit or a reveal) in its own right: stops the jump
 * running before it, registers this one's stop in `stopJumpRef`, where
 * anything that takes the view elsewhere stops it (cancelPendingJump), and
 * stops it on the user's own input on the pane. Both phases of a jump run
 * under one: the lookup for its row, which may not be committed yet, so the
 * caller looks again on later frames or timers, and the re-centring once it is
 * found (centerTranscriptRow), which starts its own and so ends the lookup's.
 * The last attempt of a lookup settles for the nearest row, which, left
 * running, could be any row of whatever the view shows by then, so each step
 * first checks `isCurrent`. `onStop` runs once, however it ends.
 */
function startJump(
  container: HTMLElement | null,
  stopJumpRef: MutableRefObject<(() => void) | null>,
  onStop: () => void = () => {},
): { isCurrent: () => boolean; stop: () => void } {
  stopJumpRef.current?.();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (container) {
      for (const type of USER_SCROLL_EVENTS) container.removeEventListener(type, stop);
    }
    if (stopJumpRef.current === stop) stopJumpRef.current = null;
    onStop();
  };
  if (container) {
    for (const type of USER_SCROLL_EVENTS) container.addEventListener(type, stop, { passive: true });
  }
  stopJumpRef.current = stop;
  return { isCurrent: () => !stopped, stop };
}

/**
 * Scrolls the transcript pane so the row's middle is at the middle of the
 * pane's client box. Written to the pane alone: scrollIntoView would also
 * scroll every scrollable ancestor (the workspace shell, the document), and
 * the re-centring calls this up to CENTER_SETTLE_FRAMES times.
 */
function centerRowInPane(container: HTMLElement, element: Element): void {
  writeTranscriptScroll(container, () => {
    const row = element.getBoundingClientRect();
    const paneMiddle = container.getBoundingClientRect().top + container.clientTop + container.clientHeight / 2;
    container.scrollTop += row.top + row.height / 2 - paneMiddle;
  });
}

/**
 * Jumps a transcript row to the middle of the view, then keeps it there while
 * the rows around it mount and settle, until the user scrolls or the next jump
 * replaces it. It runs as a jump of its own (startJump), which ends the lookup
 * that found the row, when there was one. A smooth
 * scroll ends off target on a long jump: it aims at estimated row heights,
 * and the corrections that keep the view still while rows mount
 * (useLazyRowObserver) abort it part-way.
 */
function centerTranscriptRow(
  container: HTMLElement,
  element: Element,
  stopJumpRef: MutableRefObject<(() => void) | null>,
): void {
  // Started before the first write, so the jump it replaces cannot write
  // after it.
  const jump = startJump(container, stopJumpRef);
  centerRowInPane(container, element);
  let lastTop = element.getBoundingClientRect().top;
  let stableFrames = 0;
  const settle = (framesLeft: number) => {
    if (!jump.isCurrent()) return;
    if (!element.isConnected) {
      jump.stop();
      return;
    }
    const top = element.getBoundingClientRect().top;
    if (top === lastTop) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
      centerRowInPane(container, element);
      lastTop = element.getBoundingClientRect().top;
    }
    if (stableFrames >= CENTER_STABLE_FRAMES || framesLeft <= 1) {
      jump.stop();
      return;
    }
    requestAnimationFrame(() => settle(framesLeft - 1));
  };
  requestAnimationFrame(() => settle(CENTER_SETTLE_FRAMES));
}

/**
 * Ends the running flash of each row that has one, so an earlier jump's
 * listener and timer cannot take the class off a later jump's flash.
 */
const endRowFlash = new WeakMap<Element, () => void>();

/**
 * Flashes the row a jump landed on (a search hit or a reveal) with the
 * `search-highlight-flash` class, and takes the class off once the flash has
 * played: on its own `animationend` (not one bubbling up from inside the row,
 * nor another animation of the row), or after ROW_FLASH_MAX_MS. A fixed
 * timer of the animation's length cut the flash short on a row that mounted
 * after the jump.
 *
 * A row still flashing from an earlier jump has its flash restarted. Taking
 * the class off and putting it straight back is no change to the browser,
 * which lets the running animation carry on, so layout is read in between
 * (offsetWidth), with the class off, to end that animation first. Only an
 * `animationend` after this flash's own `animationstart` ends it: the earlier
 * flash's end may already be on its way, and it comes before the restarted
 * flash's start.
 */
function flashTranscriptRow(element: Element): void {
  const restarting = endRowFlash.has(element);
  endRowFlash.get(element)?.();
  let started = false;
  const onAnimation = (event: Event) => {
    if (event.target !== element || (event as AnimationEvent).animationName !== 'search-flash') return;
    if (event.type === 'animationstart') started = true;
    else if (started) end();
  };
  const fallback = setTimeout(() => end(), ROW_FLASH_MAX_MS);
  const end = () => {
    clearTimeout(fallback);
    element.removeEventListener('animationstart', onAnimation);
    element.removeEventListener('animationend', onAnimation);
    if (endRowFlash.get(element) === end) endRowFlash.delete(element);
    element.classList.remove('search-highlight-flash');
  };
  if (restarting) void (element as HTMLElement).offsetWidth;
  endRowFlash.set(element, end);
  element.addEventListener('animationstart', onAnimation);
  element.addEventListener('animationend', onAnimation);
  element.classList.add('search-highlight-flash');
}

/**
 * Finds the rendered row for a resolved search target.
 *
 * Only an exact timestamp match counts while retries remain: the widened window
 * may not be committed yet, and accepting the nearest row then would scroll to
 * an arbitrary message and flash the highlight on it — the silent wrong answer
 * this rewrite exists to remove. `allowNearest` is used on the final attempt
 * because a hit on the second or later call of a collapsed tool group has no row
 * of its own; groupConsecutiveTools stamps the group with the run's FIRST
 * timestamp, so the group row is the nearest, not an exact, match.
 */
function findRenderedMessageElement(
  container: HTMLElement,
  timestamp: unknown,
  allowNearest: boolean,
): HTMLElement | null {
  const targetTimestamp = String(timestamp);
  const targetTime = new Date(targetTimestamp).getTime();
  const candidates = container.querySelectorAll<HTMLElement>('[data-message-timestamp]');

  let nearest: HTMLElement | null = null;
  let nearestDistance = Infinity;

  for (const candidate of candidates) {
    const candidateTimestamp = candidate.getAttribute('data-message-timestamp');
    if (!candidateTimestamp) {
      continue;
    }
    if (candidateTimestamp === targetTimestamp) {
      return candidate;
    }

    if (!allowNearest) {
      continue;
    }

    const candidateTime = new Date(candidateTimestamp).getTime();
    if (!Number.isFinite(candidateTime) || !Number.isFinite(targetTime)) {
      continue;
    }

    const distance = Math.abs(candidateTime - targetTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }

  return nearest;
}
/** Stable empty list so `chatMessages` keeps its identity while no session is selected. */
const NO_MESSAGES: NormalizedMessage[] = [];

/**
 * The visible-window size that shows the row at `index` of `total` rows, with
 * a page of context above it; the current size when the row already shows.
 * The window is a tail slice, so a row is visible when at most `count` rows
 * follow it, itself included.
 */
export function visibleCountToReveal(total: number, index: number, current: number): number {
  const needed = total - index;
  return needed <= current ? current : needed + SESSION_MESSAGES_PAGE_SIZE;
}

type UseChatSessionStateArgs = {
  isActive: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
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
};

type ScrollRestoreState = {
  height: number;
  top: number;
  anchor: HTMLElement | null;
  anchorOffset: number | null;
};

function captureScrollRestoreState(container: HTMLDivElement): ScrollRestoreState {
  const containerBounds = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll<HTMLElement>('.chat-message'))
    .find((element) => element.getBoundingClientRect().bottom >= containerBounds.top)
    ?? null;

  return {
    height: container.scrollHeight,
    top: container.scrollTop,
    anchor,
    anchorOffset: anchor
      ? anchor.getBoundingClientRect().top - containerBounds.top
      : null,
  };
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
      : String(msg.timestamp);
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
  if (msg.isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: msg.taskNotificationStatus || 'completed',
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
    // Keep attachment references on the local echo so the user bubble shows
    // its files immediately, before the server-backed copy replaces it.
    images: Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : undefined,
    files: Array.isArray(msg.files) && msg.files.length > 0 ? msg.files : undefined,
    // Survives the truncation that follows an edit, which clears every other
    // live row.
    replacesAnchorId: msg.replacesAnchorId,
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  isActive,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  externalMessageUpdate,
  newSessionTrigger,
  processingSessions,
  onSessionIdle,
  resetStreamingState,
  statusCheckSentAtRef,
  lastSeqRef,
  sessionStore,
}: UseChatSessionStateArgs) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wasNearTopRef = useRef(false);
  // The sidebar-search hit this transcript still owes the user a scroll to.
  // State rather than a ref because resolving it widens the render window,
  // and it is cleared once the row is on screen or the retries run out.
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const searchScrollActiveRef = useRef(false);
  /**
   * `isUserScrolledUp` readable from a timer callback. Both deferred follows
   * to the bottom (followToBottom) are armed while the user is at the bottom
   * and fire tens to hundreds of milliseconds later; without re-reading this
   * at fire time, a scroll-up inside that window is silently undone.
   */
  const isUserScrolledUpRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const visibleMessageCountRef = useRef(visibleMessageCount);
  visibleMessageCountRef.current = visibleMessageCount;
  // Stops the running jump (a search hit or a reveal), whether it is still
  // looking for its row or already re-centring it.
  const stopJumpRef = useRef<(() => void) | null>(null);
  // Everything that takes the view elsewhere ends a pending jump here: the
  // running one, and a search hit armed but not started yet (its claim and
  // target are set, and its jump waits for the transcript to load or the
  // Chat tab to be shown).
  const cancelPendingJump = useCallback(() => {
    stopJumpRef.current?.();
    searchScrollActiveRef.current = false;
    setSearchTarget(null);
  }, []);
  useEffect(() => cancelPendingJump, [cancelPendingJump]);
  // Counts the opens of a session: each session change (and each New Session
  // reset) starts a new one. A request captures it before its await, because
  // the id alone matches again after the user leaves the session and comes
  // back mid-request, and what it would arm belongs to the open it left.
  const sessionOpenRef = useRef(0);

  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedSessionKeyRef = useRef<string | null>(null);
  /**
   * Tracks the last processed value from `useProjectsState.newSessionTrigger`.
   *
   * The trigger itself is intentionally increment-only and routed via:
   * useProjectsState -> ProjectWorkspaceRoute -> WorkspaceMain -> ChatInterface -> this hook.
   * We compare values to ensure each explicit New Session click runs exactly one
   * reset pass in this local chat state domain.
   */
  const previousNewSessionTriggerRef = useRef(newSessionTrigger ?? 0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  useEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === previousNewSessionTriggerRef.current) {
      return;
    }
    previousNewSessionTriggerRef.current = trigger;
    sessionOpenRef.current += 1;
    // A jump into the transcript being left must not land on the fresh draft
    // (the session change does the same, but it does not run when the route
    // is unchanged).
    cancelPendingJump();

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
    // A load still in flight belongs to the open being left; it leaves these
    // alone when it lands (the first page, loadOlderMessages, loadAllMessages).
    isLoadingMoreRef.current = false;
    setIsLoadingMoreMessages(false);
    setIsLoadingAllMessages(false);
    setIsLoadingSessionMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    wasNearTopRef.current = false;
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
  }, [cancelPendingJump, newSessionTrigger, onSessionIdle, resetStreamingState]);

  /* ---------------------------------------------------------------- */
  /*  Derive processing state for the viewed session                  */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;

  // The activity indicator always reflects the latest status of the session
  // being viewed — never stale local UI state from the last time it was
  // open. Session ids are concrete before any send, so no pending
  // placeholder entry exists anymore. Background-only work shows in the
  // indicator but is not a response in flight: the composer can send.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null && !sessionActivity.background;
  const canAbortSession = isProcessing && sessionActivity.canInterrupt;

  // Ref mirror so effects can read the latest map without re-running on
  // every activity transition.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  const isActiveRef = useRef(isActive);
  const activeSessionIdRef = useRef(activeSessionId);
  isActiveRef.current = isActive;
  activeSessionIdRef.current = activeSessionId;
  // Whether the open a request captured before its await is still the one
  // showing (sessionOpenRef).
  const isSameSessionOpen = useCallback((sessionId: string, open: number) => (
    activeSessionIdRef.current === sessionId && sessionOpenRef.current === open
  ), []);

  // Widening the window puts rows in front of the first one, like a page of
  // older messages, so it takes the same restore: the view stays where it was
  // until the caller scrolls on purpose.
  const widenVisibleWindow = useCallback((count: number) => {
    const container = scrollContainerRef.current;
    // A hidden tab has no position to keep, and a restore armed there would
    // fire on return and override the follow-to-bottom.
    const isShown = isActiveRef.current && container && container.getBoundingClientRect().height > 0;
    if (count > visibleMessageCountRef.current && isShown && !pendingScrollRestoreRef.current) {
      pendingScrollRestoreRef.current = captureScrollRestoreState(container);
    }
    // Advanced now rather than on the next render, so a second widen before
    // it (two "Load earlier" clicks) counts from this one instead of
    // collapsing into it. The render reassigns it from state anyway.
    visibleMessageCountRef.current = Math.max(visibleMessageCountRef.current, count);
    setVisibleMessageCount((previous) => Math.max(previous, count));
  }, []);

  // Lands a jump (a search hit or a reveal) on its row: centres it and
  // flashes it, so the user sees which row they were brought to. Starting a
  // jump ends the initial settle: left running, it writes the bottom every
  // frame while the jump re-centres its row, and it can outlast the
  // re-centring and leave the view at the bottom.
  const jumpToTranscriptRow = useCallback((container: HTMLElement, element: Element) => {
    pendingInitialScrollRef.current = false;
    centerTranscriptRow(container, element, stopJumpRef);
    flashTranscriptRow(element);
  }, []);

  // Takes the paging, and the token usage when the store has a report of it,
  // from the slot of the session showing: the rows it holds are what is
  // rendered, and its offset is where fetchMore pages on from.
  const applySlotPaging = useCallback((slot: SessionSlot) => {
    setHasMoreMessages(slot.hasMore);
    setTotalMessages(slot.total);
    messagesOffsetRef.current = slot.offset;
    if (slot.tokenUsage !== undefined) {
      setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
    }
  }, []);

  const latestRefreshExecutorRef = useRef<(sessionId: string) => Promise<boolean | void>>(
    async () => true,
  );
  latestRefreshExecutorRef.current = async (sessionId: string) => {
    const result = await sessionStore.refreshLatestFromServer(sessionId, {
      limit: SESSION_MESSAGES_PAGE_SIZE,
      canRequest: () => (
        isActiveRef.current
        && activeSessionIdRef.current === sessionId
      ),
    });
    if (result.slot && activeSessionIdRef.current === sessionId) {
      applySlotPaging(result.slot);
    }
    return !result.deferred;
  };

  const refreshCoordinatorRef = useRef<ReturnType<typeof createMessageHistoryRefreshCoordinator> | null>(null);
  if (!refreshCoordinatorRef.current) {
    refreshCoordinatorRef.current = createMessageHistoryRefreshCoordinator(
      (sessionId) => latestRefreshExecutorRef.current(sessionId),
      (sessionId) => isActiveRef.current && activeSessionIdRef.current === sessionId,
    );
  }

  const requestLatestMessages = useCallback((sessionId: string, allowNetwork = isActiveRef.current) => (
    refreshCoordinatorRef.current?.request(sessionId, allowNetwork) ?? Promise.resolve()
  ), []);

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const flushedPendingUserMessageRef = useRef<ChatMessage | null>(null);

  // Hidden Chat tabs keep collecting realtime rows without re-rendering the
  // CSS-hidden tree. Activation itself renders once and reads the latest cache.
  const activeSessionForStore = isActive ? activeSessionId : null;
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionForStore !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionForStore;
    sessionStore.setActiveSession(activeSessionForStore);
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

    const prov = readSelectedProvider();
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }

    flushedPendingUserMessageRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSessionId, pendingUserMessage, sessionStore]);

  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : NO_MESSAGES;

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    return all;
  }, [storeMessages, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage                                                       */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet — show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    const prov = readSelectedProvider();
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore]);

  // Mirrors the state into a ref so the two deferred follows to the bottom
  // can re-read it at fire time. An effect rather than assignments next to each
  // `setIsUserScrolledUp` call, because the setter is also returned from this
  // hook and driven from the composer.
  useEffect(() => {
    isUserScrolledUpRef.current = isUserScrolledUp;
  }, [isUserScrolledUp]);

  const writeScrollBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    writeTranscriptScroll(container, () => { container.scrollTop = container.scrollHeight; });
  }, []);

  // The user going to the bottom (the scroll-to-bottom button, a sent
  // message): that overrides any jump still loading, looking for or settling
  // on its row.
  const scrollToBottom = useCallback(() => {
    cancelPendingJump();
    writeScrollBottom();
  }, [cancelPendingJump, writeScrollBottom]);

  // The transcript following the bottom on its own, from a timer armed a
  // little earlier (new output, an external update's refresh). It is not the
  // user leaving a jump, so it never stops one: it does nothing while a jump
  // is pending, which is while a search holds its claim (from the click,
  // through its transcript fetch, to landing) or any jump is running
  // (`stopJumpRef`), and while the user is scrolled up. Checked when it
  // fires, since a jump can start between arming and firing. A follow it
  // declines is not retried; a search jump that gives up follows once
  // itself (giveUp in the search effect).
  const followToBottom = useCallback(() => {
    if (searchScrollActiveRef.current || stopJumpRef.current) return;
    if (isUserScrolledUpRef.current) return;
    writeScrollBottom();
  }, [writeScrollBottom]);

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
      if (!isActive) return false;
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return false;
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) return false;

      const open = sessionOpenRef.current;
      isLoadingMoreRef.current = true;
      setIsLoadingMoreMessages(true);
      const scrollRestoreState = captureScrollRestoreState(container);

      try {
        const result = await sessionStore.fetchMore(selectedSession.id, {
          limit: SESSION_MESSAGES_PAGE_SIZE,
          canRequest: () => (
            isActiveRef.current
            && activeSessionIdRef.current === selectedSession.id
          ),
        });
        // A page for a session the user has since left, even one they came
        // back to, is not this open's.
        if (!isSameSessionOpen(selectedSession.id, open)) return false;
        const { slot, prependedCount } = result;
        applySlotPaging(slot);

        if (prependedCount === 0) {
          if (!slot.hasMore) {
            allMessagesLoadedRef.current = true;
            setAllMessagesLoaded(true);
            if (loadAllOverlayTimerRef.current) {
              clearTimeout(loadAllOverlayTimerRef.current);
              loadAllOverlayTimerRef.current = null;
            }
            setShowLoadAllOverlay(false);
          }
          return false;
        }

        pendingScrollRestoreRef.current = scrollRestoreState;
        setVisibleMessageCount((prev) => prev + SESSION_MESSAGES_PAGE_SIZE);
        if (!slot.hasMore) {
          allMessagesLoadedRef.current = true;
          setAllMessagesLoaded(true);
          if (loadAllOverlayTimerRef.current) {
            clearTimeout(loadAllOverlayTimerRef.current);
            loadAllOverlayTimerRef.current = null;
          }
          setShowLoadAllOverlay(false);
        }
        return true;
      } finally {
        // The flags belong to the open that set them. A newer open reset them
        // and may have a load of its own in flight, which this must not end.
        if (sessionOpenRef.current === open) {
          isLoadingMoreRef.current = false;
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [applySlotPaging, hasMoreMessages, isActive, isLoadingMoreMessages, isSameSessionOpen, selectedProject, selectedSession, sessionStore],
  );

  const handleScroll = useCallback(async () => {
    if (!isActive) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);
    scrollPositionRef.current = {
      height: container.scrollHeight,
      top: container.scrollTop,
    };

    const scrolledNearTop = container.scrollTop < 100;

    // "Load all" prompt: appear (with fade-in) when the user reaches the top
    if (scrolledNearTop && hasMoreMessages && !allMessagesLoadedRef.current) {
      if (!wasNearTopRef.current) {
        wasNearTopRef.current = true;
        if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);

        setShowLoadAllOverlay(true);
        loadAllOverlayTimerRef.current = setTimeout(() => {
          setShowLoadAllOverlay(false);
          loadAllOverlayTimerRef.current = null;
        }, 2500);
      }
    } else if (!scrolledNearTop) {
      wasNearTopRef.current = false;
    }

    if (!allMessagesLoadedRef.current) {
      if (!scrolledNearTop) { topLoadLockRef.current = false; return; }
      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) topLoadLockRef.current = false;
        return;
      }
      const didLoad = await loadOlderMessages(container);
      if (didLoad) topLoadLockRef.current = true;
    }
  }, [hasMoreMessages, isActive, isNearBottom, loadOlderMessages]);

  const wasChatActiveRef = useRef(isActive);
  useLayoutEffect(() => {
    const becameActive = isActive && !wasChatActiveRef.current;
    wasChatActiveRef.current = isActive;
    if (!isActive || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    if (pendingScrollRestoreRef.current) {
      const { height, top, anchor, anchorOffset } = pendingScrollRestoreRef.current;
      // Rows swapped in by this commit have already had the view held by the
      // manual anchoring (their layout effects run first), so the anchor is
      // measured where that left it and nothing is counted twice. The
      // fallback sets an absolute position, which a hold cannot add to.
      writeTranscriptScroll(container, () => {
        if (anchor?.isConnected && anchorOffset !== null) {
          const nextAnchorOffset = (
            anchor.getBoundingClientRect().top
            - container.getBoundingClientRect().top
          );
          container.scrollTop += nextAnchorOffset - anchorOffset;
        } else {
          container.scrollTop = top + Math.max(container.scrollHeight - height, 0);
        }
      });
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (becameActive) {
      writeTranscriptScroll(container, () => {
        container.scrollTop = isUserScrolledUp
          ? scrollPositionRef.current.top
          : container.scrollHeight;
      });
    }
  }, [chatMessages.length, isActive, isUserScrolledUp, visibleMessageCount]);

  // Reset scroll/pagination state on session change
  useEffect(() => {
    sessionOpenRef.current += 1;
    // A search jump belongs to the transcript it was requested against. Left
    // armed across a session change it did two visible things to the session
    // the user actually opened: the initial scroll bailed (it declines while a
    // jump is pending) so the transcript opened part-way up, and then, once the
    // retries ran out and started accepting the nearest row by timestamp, it
    // scrolled to an unrelated message and flashed the search highlight on it.
    //
    // Clearing it here (cancelPendingJump drops a hit not started yet too)
    // is safe for the jump itself: the effect that reads
    // `__searchTargetSnippet` off the newly selected session runs after this
    // one, so a session opened *from* a search result re-arms immediately.
    cancelPendingJump();

    pendingInitialScrollRef.current = true;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    wasNearTopRef.current = false;
    setIsUserScrolledUp(false);
    // A first page, an older page or a "Load all" still in flight belongs to
    // the open being left, and leaves these alone when it lands, so the new
    // open's own loads are not held up by it.
    isLoadingMoreRef.current = false;
    setIsLoadingMoreMessages(false);
    setIsLoadingAllMessages(false);
    setIsLoadingSessionMessages(false);
  }, [cancelPendingJump, selectedProject?.projectId, selectedSession?.id]);

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
    if (!isActive) return;
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;
    if (chatMessages.length === 0) { pendingInitialScrollRef.current = false; return; }
    if (searchScrollActiveRef.current) { pendingInitialScrollRef.current = false; return; }

    const container = scrollContainerRef.current;
    let frame = 0;
    let lastHeight = 0;
    let stableCount = 0;
    let rafId = 0;

    const tick = () => {
      if (!pendingInitialScrollRef.current || !scrollContainerRef.current) return;
      // The loop rewrites the same bottom for its last stable frames, which
      // the helper does not note.
      writeTranscriptScroll(container, () => { container.scrollTop = container.scrollHeight; });
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
  }, [chatMessages.length, isActive, isLoadingSessionMessages, scrollToBottom]);

  // Session replay/subscription remains active regardless of which main tab is
  // visible. Only persisted-history HTTP traffic is visibility-gated below.
  useEffect(() => {
    if (!selectedSession || !selectedProject || !ws) return;

    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [lastSeqRef, selectedProject, selectedSession, sendMessage, statusCheckSentAtRef, ws]);

  // Main session loading effect — store-based.
  //
  // The dependency list is deliberately narrower than the values the body
  // reads. `selectedSession` is tracked by id only, so a websocket-driven list
  // refresh that hands back a new object for the same session does not reload
  // it; `currentSessionId` is read as the previously-loaded session (the body
  // itself is what advances it), so listing it would re-enter the effect right
  // after every load. Both are always current when the effect does run,
  // because React recreates the closure on each render.
  useEffect(() => {
    if (!selectedSession || !selectedProject) {
      // A freshly created session can be mid-run before the router has a
      // canonical selectedSession (the URL effect synthesizes one on the
      // next render). Keep the active view intact instead of wiping it — but
      // only for a response in flight: a session whose turn has ended with
      // background work still running has a canonical id, so a missing
      // selection there is a real navigation away.
      const activity = currentSessionId ? processingSessionsRef.current?.get(currentSessionId) : undefined;
      if (activity && !activity.background) {
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

    if (!isActive) {
      setIsLoadingSessionMessages(false);
      return;
    }

    const selectedSessionId = selectedSession.id;
    const sessionKey = `${selectedSessionId}:${selectedProject.projectId}`;

    const existingSlot = sessionStore.getSessionSlot(selectedSessionId);
    const isCurrentHydratedSession =
      lastLoadedSessionKeyRef.current === sessionKey
      && Boolean(existingSlot?.fetchedAt);

    // Returning from another tab must not reset pagination or scroll. Refresh
    // a stale hydrated session through the bounded tail path instead.
    if (isCurrentHydratedSession) {
      if (sessionStore.isStale(selectedSessionId)) {
        void requestLatestMessages(selectedSessionId);
      }
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
    wasNearTopRef.current = false;
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);

    if (sessionChanged) {
      setTokenBudget(null);
    }

    setCurrentSessionId(selectedSessionId);

    lastLoadedSessionKeyRef.current = sessionKey;

    // Fetch from server → store updates → chatMessages re-derives automatically
    const open = sessionOpenRef.current;
    setIsLoadingSessionMessages(true);
    sessionStore.fetchFromServer(selectedSessionId, {
      limit: SESSION_MESSAGES_PAGE_SIZE,
      offset: 0,
      canRequest: () => (
        isActiveRef.current
        && activeSessionIdRef.current === selectedSessionId
      ),
    }).then(outcome => {
      // A page for a session the user has since left, even one they came
      // back to, is not this open's, and neither is the loading flag.
      if (!isSameSessionOpen(selectedSessionId, open)) return;
      // The page loaded, or the load failed over rows an earlier open left
      // in the store (`fetchedAt`), which are what is rendered: the slot's
      // paging describes them. A refused load, or a failed one with nothing
      // loaded before, leaves the paging reset above.
      if (outcome && (outcome.ok || outcome.slot.fetchedAt)) {
        applySlotPaging(outcome.slot);
      }
      setIsLoadingSessionMessages(false);
    }).catch(() => {
      if (isSameSessionOpen(selectedSessionId, open)) setIsLoadingSessionMessages(false);
    });
  }, [
    applySlotPaging,
    isActive,
    isSameSessionOpen,
    resetStreamingState,
    requestLatestMessages,
    selectedProject,
    selectedSession?.id,
    sessionStore,
  ]);

  // Hidden refresh signals are coalesced. An initial page load supersedes a
  // pending latest refresh for an unhydrated/loading slot; otherwise activation
  // flushes exactly one request for the selected session.
  useEffect(() => {
    if (!isActive || !activeSessionId) return;

    const slot = sessionStore.getSessionSlot(activeSessionId);
    if (!slot?.fetchedAt || slot.status === 'loading') {
      refreshCoordinatorRef.current?.discardPending(activeSessionId);
      return;
    }

    void refreshCoordinatorRef.current?.flushPending(activeSessionId);
  }, [activeSessionId, isActive, sessionStore]);

  // What the external-update effect below reads when an update comes in,
  // without re-running on it.
  const externalUpdateTarget = { sessionId: selectedSession?.id ?? null, hasProject: Boolean(selectedProject), isProcessing };
  const externalUpdateTargetRef = useRef(externalUpdateTarget);
  externalUpdateTargetRef.current = externalUpdateTarget;

  // External message update (the viewed session's transcript changed on disk
  // while no run is active here). Keyed on the update count alone: listing
  // the session object re-ran it for every new object of the same session
  // (a sidebar search click hands over one), refreshing again and arming
  // another follow to the bottom each time.
  useEffect(() => {
    if (!externalMessageUpdate) return;
    const { sessionId, hasProject, isProcessing: isProcessingNow } = externalUpdateTargetRef.current;
    if (!sessionId || !hasProject) return;

    const reloadExternalMessages = async () => {
      try {
        // Skip store refresh during active streaming
        if (!isProcessingNow) {
          const shouldStickToBottom = isActiveRef.current && isNearBottom();
          await requestLatestMessages(sessionId);

          if (shouldStickToBottom) {
            setTimeout(followToBottom, 200);
          }
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [externalMessageUpdate, followToBottom, isNearBottom, requestLatestMessages]);

  // Search navigation target
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
      });
    }
  }, [selectedSession]);

  // Scroll to search target
  useEffect(() => {
    if (!isActive || !searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    setSearchTarget(null);

    const scrollToTarget = async () => {
      // The jump starts here, before its transcript is fetched, so everything
      // that stops a jump (the user's scrollToBottom, the user's own input, a
      // newer reveal or search, a session change, unmount) drops it during the
      // fetch too. Following the bottom on its own does not stop it: it
      // declines while the jump is pending and is not retried
      // (followToBottom), so a jump that gives up follows once (giveUp).
      // Stopping it, for whatever reason, drops its pending retry and
      // releases the claim, so the follow and the settle are not held off by
      // a jump that will never land.
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      const lookup = startJump(scrollContainerRef.current, stopJumpRef, () => {
        if (retryTimer) clearTimeout(retryTimer);
        searchScrollActiveRef.current = false;
      });
      // Stopping a previous jump released the claim; this one holds it again.
      searchScrollActiveRef.current = true;

      // A jump that gives up (its hit is not in the transcript, or no row
      // turned up) held the follow and the initial settle off while it was
      // pending, and nothing re-arms them, so it follows the bottom once,
      // unless the user is scrolled up. A jump that lands, or is stopped by
      // anything else (the user, a newer jump, a session change), does not.
      const giveUp = () => {
        lookup.stop();
        followToBottom();
      };

      // A hidden Chat tab has nothing to centre a row in. The jump is put back
      // for when the tab is shown again (this effect runs on `isActive` and
      // declines while hidden), still holding the claim, so the follow and
      // the settle stay off until it has landed.
      const waitForChatTab = () => {
        lookup.stop();
        searchScrollActiveRef.current = true;
        setSearchTarget(target);
      };

      if (!allMessagesLoadedRef.current && selectedSession && selectedProject) {
          const requestSessionId = selectedSession.id;
          const open = sessionOpenRef.current;
          try {
            // Load all messages into the store for search navigation
            const outcome = await sessionStore.fetchFromServer(requestSessionId, {
              limit: null,
              offset: 0,
              canRequest: () => (
                isActiveRef.current
                && activeSessionIdRef.current === requestSessionId
              ),
            });
            // A transcript for a session the user has since left, even one
            // they came back to, is not this open's; the session change
            // already stopped this jump.
            if (!isSameSessionOpen(requestSessionId, open)) return;
            // The store reports a failed request through `ok`, not by
            // throwing: that falls through like the catch below. A loaded one
            // is in the store whatever became of the jump, so the paging
            // records it even when the jump was stopped meanwhile; otherwise
            // scrolling up would page through rows the store already holds.
            if (outcome?.ok) {
              // Fetch the whole transcript so an old hit can be found, but do
              // not render all of it; the window below is widened to exactly
              // what the resolved target needs.
              setHasMoreMessages(false);
              setTotalMessages(outcome.slot.total);
              messagesOffsetRef.current = outcome.slot.offset;
              setAllMessagesLoaded(true);
              allMessagesLoadedRef.current = true;
            }
            // A jump stopped for any other reason while its transcript loaded
            // is over too, and must not stop the jump that replaced it.
            if (!lookup.isCurrent()) return;
          } catch {
            if (!isSameSessionOpen(requestSessionId, open)) return;
            if (!lookup.isCurrent()) return;
            // Fall through and scroll in current messages
          }
          // Whatever the fetch did (refused, failed or loaded), behind another
          // tab the tab's return runs this again, and a fetch that did not
          // load is retried then.
          if (!isActiveRef.current) {
            waitForChatTab();
            return;
          }
      }
      // Resolve the target against the loaded transcript rather than the DOM.
      // The store is the freshest source here: the `fetchFromServer` above has
      // landed but `chatMessages` is from the render that scheduled this effect.
      const messagesForSearch = activeSessionIdRef.current
        ? normalizedToChatMessages(sessionStore.getMessages(activeSessionIdRef.current))
        : chatMessages;
      const targetIndex = findSearchTargetIndex(messagesForSearch, target);
      if (targetIndex < 0) {
        // The target is not in the transcript at all. Scrolling somewhere
        // plausible would claim a hit that does not exist.
        giveUp();
        return;
      }

      // Widen the window so the target is rendered. `visibleMessages` is a tail
      // slice, so covering index N means rendering everything after it.
      const requiredVisibleCount = resolveSearchWindowSize(
        messagesForSearch.length,
        targetIndex,
        SEARCH_TARGET_CONTEXT_MESSAGES,
      );
      widenVisibleWindow(requiredVisibleCount);

      const targetTimestamp = messagesForSearch[targetIndex].timestamp;

      const scrollToRenderedTarget = (retriesLeft: number) => {
        if (!lookup.isCurrent()) return;
        if (!isActiveRef.current) {
          waitForChatTab();
          return;
        }
        const container = scrollContainerRef.current;
        if (!container) {
          lookup.stop();
          return;
        }

        // The target is inside the window by construction, so this only waits
        // for React to commit the widened list. A target collapsed inside a
        // tool group resolves to that group, which carries the same timestamp.
        const targetElement = findRenderedMessageElement(
          container,
          targetTimestamp,
          retriesLeft === 0,
        );

        if (targetElement) {
          // The jump stops the lookup, which releases the claim.
          jumpToTranscriptRow(container, targetElement);
          return;
        }

        if (retriesLeft > 0) {
          retryTimer = setTimeout(
            () => scrollToRenderedTarget(retriesLeft - 1),
            SEARCH_SCROLL_RETRY_DELAY_MS,
          );
          return;
        }

        giveUp();
      };

      retryTimer = setTimeout(
        () => scrollToRenderedTarget(SEARCH_SCROLL_RETRIES),
        150,
      );
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isActive, isLoadingSessionMessages, searchTarget]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const fetchInitialTokenUsage = async () => {
      try {
        // The provider module resolves storage and provider details from the session id.
        const response = await api.providers.sessionTokenUsage(selectedSession.id);
        if (response.ok) {
          const payload = await response.json();
          setTokenBudget(payload.data ?? null);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedSession?.id]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) return chatMessages;
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!isActive) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    scrollPositionRef.current = { height: container.scrollHeight, top: container.scrollTop };
  });

  useEffect(() => {
    if (!isActive) return;
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;

    // followToBottom checks again when the timer fires, for a jump started
    // or a scroll up made in between.
    if (!isUserScrolledUp) {
      setTimeout(followToBottom, 50);
    }
  }, [chatMessages.length, followToBottom, isActive, isLoadingMoreMessages, isUserScrolledUp]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // "Load all" overlay visibility is driven by scroll-to-top in handleScroll;
  // timers are cleared on session change via the reset effect above.

  const loadAllMessages = useCallback(async () => {
    if (!isActive) return;
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const requestSessionId = selectedSession.id;
    const open = sessionOpenRef.current;
    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);
    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }

    const container = scrollContainerRef.current;
    const scrollRestoreState = container ? captureScrollRestoreState(container) : null;

    try {
      const outcome = await sessionStore.fetchFromServer(requestSessionId, {
        limit: null,
        offset: 0,
        canRequest: () => (
          isActiveRef.current
          && activeSessionIdRef.current === requestSessionId
        ),
      });

      // The user may have switched sessions while the transcript loaded, or
      // switched away and back, which is a new open of the same session.
      if (!isSameSessionOpen(requestSessionId, open)) return;

      // The store reports a failed request through `ok`, not by throwing:
      // nothing more was loaded, so nothing is armed or shown.
      if (outcome?.ok) {
        const { slot } = outcome;
        if (scrollRestoreState) {
          pendingScrollRestoreRef.current = scrollRestoreState;
        }

        setHasMoreMessages(false);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.offset;
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => {
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          loadAllFinishedTimerRef.current = null;
        }, 2500);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      // As in loadOlderMessages: a newer open's flags are not this one's to end.
      if (sessionOpenRef.current === open) {
        isLoadingMoreRef.current = false;
        setIsLoadingAllMessages(false);
      }
    }
  }, [isActive, isSameSessionOpen, selectedSession, selectedProject, isLoadingAllMessages, sessionStore]);

  /**
   * Fetches the whole transcript into the store and returns it, without
   * touching the render window.
   *
   * Export needs every message; the screen does not. Keeping those separate is
   * why exporting a long conversation no longer silently produces a file
   * containing only its last page. For the same reason a fetch that failed, or
   * was refused because the user left the session first, rejects instead of
   * handing back the rows already loaded.
   */
  const loadFullTranscript = useCallback(async (): Promise<ChatMessage[]> => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      return [];
    }

    const outcome = await sessionStore.fetchFromServer(sessionId, {
      limit: null,
      offset: 0,
      canRequest: () => activeSessionIdRef.current === sessionId,
    });
    if (!outcome?.ok) {
      throw new Error(`Could not load the whole transcript of ${sessionId}`);
    }

    return normalizedToChatMessages(sessionStore.getMessages(sessionId));
  }, [sessionStore]);

  const loadEarlierMessages = useCallback(() => {
    widenVisibleWindow(visibleMessageCountRef.current + 100);
  }, [widenVisibleWindow]);

  // Brings one row into view even when it is outside the visible window or
  // sits in a lazy row that has not mounted: widen the window to include it,
  // then scroll to the row's wrapper, which is in the DOM as soon as the row
  // is inside the window, mounted or not.
  const revealMessage = useCallback((message: ChatMessage) => {
    const index = chatMessages.indexOf(message);
    if (index >= 0) {
      widenVisibleWindow(visibleCountToReveal(chatMessages.length, index, visibleMessageCountRef.current));
    }

    const lookup = startJump(scrollContainerRef.current, stopJumpRef);
    const attempt = (remaining: number) => {
      if (!lookup.isCurrent()) return;
      const container = scrollContainerRef.current;
      // The widened window commits after this frame, so the row can be absent
      // on the first attempts; only the last one may settle for the nearest
      // row (a hit collapsed inside a tool group carries the group's
      // timestamp), or the first attempt scrolls to an unrelated row and the
      // retries never run.
      const element = container ? findRenderedMessageElement(container, message.timestamp, remaining === 0) : null;
      if (container && element) {
        jumpToTranscriptRow(container, element);
        return;
      }
      if (remaining > 0) {
        requestAnimationFrame(() => attempt(remaining - 1));
      } else {
        lookup.stop();
      }
    };
    requestAnimationFrame(() => attempt(10));
  }, [chatMessages, jumpToTranscriptRow, widenVisibleWindow]);

  return {
    chatMessages,
    addMessage,
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
    loadEarlierMessages,
    revealMessage,
    loadAllMessages,
    loadFullTranscript,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    requestLatestMessages,
  };
}
