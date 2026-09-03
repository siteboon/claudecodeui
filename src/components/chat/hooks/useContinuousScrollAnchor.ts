import { useCallback, useEffect, useRef, useState } from 'react';

export type UseContinuousScrollAnchorOptions = {
  isActive: boolean;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  allMessagesLoaded: boolean;
  onLoadOlder: (container: HTMLDivElement) => Promise<boolean | void>;
  onNearTop?: (nearTop: boolean) => void;
  bottomThreshold?: number;
  topThreshold?: number;
  /**
   * The inner wrapper that grows/shrinks with message content. Observed with a
   * ResizeObserver so a pinned viewport stays glued to the bottom while
   * content streams in; the scroll container itself is observed too (its
   * content box changes when the bottom padding toggles with the activity bar).
   */
  scrollContentRef?: React.RefObject<HTMLElement | null>;
};

export type UseContinuousScrollAnchorReturn = {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  isUserScrolledUp: boolean;
  setIsUserScrolledUp: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Live pin state mirrored from scroll geometry. True while the viewport sits
   * within `bottomThreshold` of the bottom. Unlike `isUserScrolledUp`, this
   * never triggers a render, so long-running effects (e.g. the initial
   * scroll-to-bottom loop) can poll it and bail the moment the user scrolls up.
   */
  isPinnedToBottomRef: React.RefObject<boolean>;
  isNearBottom: () => boolean;
  scrollToBottom: (smooth?: boolean) => void;
  /** Invoked by the chat pane when its scroll container mounts/unmounts. */
  notifyPaneMounted: () => void;
  notifyContentMutating: () => void;
};

const DEFAULT_BOTTOM_THRESHOLD = 60;
const DEFAULT_TOP_THRESHOLD = 100;

/**
 * Scroll stabilization for chat message lists, built on the browser's native
 * scroll anchoring instead of fighting it:
 *
 * 1. Native anchoring (overflow-anchor, left at its default) keeps the user's
 *    reading position stable whenever content above the viewport changes
 *    height (older messages prepended, images/code blocks finishing layout,
 *    content-visibility placeholders resolving to real heights).
 * 2. Stick-to-bottom: a ResizeObserver on the content wrapper re-pins the
 *    viewport to the bottom when content grows while the user is parked at the
 *    bottom. ResizeObserver callbacks run after layout but before paint, so
 *    streaming appends never flash a stale frame.
 * 3. The one case native anchoring refuses to handle is a prepend while
 *    scrollTop is exactly 0 (anchoring is boundary-suppressed there), so the
 *    load-older path applies an explicit height-diff compensation.
 */
export function useContinuousScrollAnchor({
  isActive,
  hasMoreMessages,
  isLoadingMore,
  allMessagesLoaded,
  onLoadOlder,
  onNearTop,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
  topThreshold = DEFAULT_TOP_THRESHOLD,
  scrollContentRef,
}: UseContinuousScrollAnchorOptions): UseContinuousScrollAnchorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  // The chat pane mounts later than this hook's owner whenever ChatInterface
  // renders its "select a project" placeholder first. Listener/observer setup
  // re-runs when the pane reports itself mounted.
  const [paneMountedTick, setPaneMountedTick] = useState(0);
  const notifyPaneMounted = useCallback(() => {
    setPaneMountedTick((tick) => tick + 1);
  }, []);

  // Pin state maintained from scroll events without triggering renders. Only
  // a real flip of isUserScrolledUp (the scroll-to-bottom affordance) renders.
  const isPinnedToBottomRef = useRef(true);
  const isUserScrolledUpRef = useRef(false);

  // Guard while a programmatic smooth scrollToBottom is in flight: its own
  // intermediate scroll events must not be mistaken for the user scrolling up.
  const smoothScrollInFlightRef = useRef(false);

  // Momentum lock at the top to avoid thrashing load-older requests.
  const topBoundaryLockedRef = useRef(false);
  const wasNearTopRef = useRef(false);

  // Latest callbacks/flags kept in refs so `handleScroll` stays referentially
  // stable and the native scroll listener is attached exactly once.
  const isActiveRef = useRef(isActive);
  const onNearTopRef = useRef(onNearTop);
  const onLoadOlderRef = useRef(onLoadOlder);
  const loadStateRef = useRef({ hasMoreMessages, isLoadingMore, allMessagesLoaded });
  useEffect(() => {
    isActiveRef.current = isActive;
    onNearTopRef.current = onNearTop;
    onLoadOlderRef.current = onLoadOlder;
    loadStateRef.current = { hasMoreMessages, isLoadingMore, allMessagesLoaded };
  });

  const isNearBottom = useCallback((): boolean => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= bottomThreshold;
  }, [bottomThreshold]);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isPinnedToBottomRef.current = true;
    smoothScrollInFlightRef.current = smooth;
    if (isUserScrolledUpRef.current) {
      isUserScrolledUpRef.current = false;
      setIsUserScrolledUp(false);
    }
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  /**
   * Compensates a top prepend that landed while scrollTop was 0, where the
   * browser suppresses native anchoring. Called after the data mutation via
   * double-rAF so it measures the post-commit layout.
   */
  const stabilizeTopPrepend = useCallback((prevHeight: number, prevTop: number) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container || prevTop > 1) return;
        const heightDiff = container.scrollHeight - prevHeight;
        if (heightDiff > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      });
    });
  }, []);

  // Main scroll event handler — geometry reads only, one state write per flip.
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !isActiveRef.current) return;

    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= bottomThreshold;

    if (smoothScrollInFlightRef.current) {
      if (nearBottom) smoothScrollInFlightRef.current = false;
    } else {
      isPinnedToBottomRef.current = nearBottom;
    }
    const userUp = !isPinnedToBottomRef.current;
    if (isUserScrolledUpRef.current !== userUp) {
      isUserScrolledUpRef.current = userUp;
      setIsUserScrolledUp(userUp);
    }

    const scrolledNearTop = container.scrollTop < topThreshold;
    if (scrolledNearTop !== wasNearTopRef.current) {
      wasNearTopRef.current = scrolledNearTop;
      onNearTopRef.current?.(scrolledNearTop);
    }

    // Top load handling with momentum lock
    const loadState = loadStateRef.current;
    if (!loadState.allMessagesLoaded && loadState.hasMoreMessages && !loadState.isLoadingMore) {
      if (!scrolledNearTop) {
        topBoundaryLockedRef.current = false;
        return;
      }

      if (topBoundaryLockedRef.current) {
        // Hysteresis release: unlock once scrolled slightly down (> 20px)
        if (container.scrollTop > 20) {
          topBoundaryLockedRef.current = false;
        }
        return;
      }

      topBoundaryLockedRef.current = true;
      const prevHeight = container.scrollHeight;
      const prevTop = container.scrollTop;

      void Promise.resolve(onLoadOlderRef.current(container)).finally(() => {
        stabilizeTopPrepend(prevHeight, prevTop);
      });
    }
  }, [bottomThreshold, stabilizeTopPrepend, topThreshold]);

  // Attach the native passive scroll listener exactly once per pane mount.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, paneMountedTick]);

  // Stick-to-bottom: follow content growth only while pinned. While the user
  // is scrolled up, native anchoring keeps the reading position stable.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!isActiveRef.current || !isPinnedToBottomRef.current) return;
      container.scrollTop = container.scrollHeight;
    });

    observer.observe(container);
    const content = scrollContentRef?.current;
    if (content && content !== container) {
      observer.observe(content);
    }

    return () => observer.disconnect();
  }, [paneMountedTick, scrollContentRef]);

  /**
   * Announces an imminent content mutation that prepends content while the
   * user sits at the very top (load-all, expand-visible-window), where native
   * anchoring is suppressed. A no-op everywhere else.
   */
  const notifyContentMutating = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || container.scrollTop > 1) return;
    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;
    stabilizeTopPrepend(prevHeight, prevTop);
  }, [stabilizeTopPrepend]);

  // External state resets (session switch, composer send) go through this so
  // the pin refs never desync from the React state.
  const setUserScrolledUp = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (action) => {
      setIsUserScrolledUp((prev) => {
        const next = typeof action === 'function'
          ? (action as (current: boolean) => boolean)(prev)
          : action;
        isUserScrolledUpRef.current = next;
        isPinnedToBottomRef.current = !next;
        return next;
      });
    },
    [],
  );

  return {
    scrollContainerRef,
    isUserScrolledUp,
    setIsUserScrolledUp: setUserScrolledUp,
    isPinnedToBottomRef,
    isNearBottom,
    scrollToBottom,
    notifyPaneMounted,
    notifyContentMutating,
  };
}
