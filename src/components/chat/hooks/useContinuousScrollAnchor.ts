import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type UseContinuousScrollAnchorOptions = {
  isActive: boolean;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  allMessagesLoaded: boolean;
  onLoadOlder: (container: HTMLDivElement) => Promise<boolean | void>;
  onNearTop?: (nearTop: boolean) => void;
  bottomThreshold?: number;
  topThreshold?: number;
};

export type UseContinuousScrollAnchorReturn = {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  isUserScrolledUp: boolean;
  setIsUserScrolledUp: React.Dispatch<React.SetStateAction<boolean>>;
  isNearBottom: () => boolean;
  scrollToBottom: (smooth?: boolean) => void;
  handleScroll: () => void;
  onWheel: () => void;
  onTouchMove: () => void;
  notifyContentMutating: () => void;
};

const DEFAULT_BOTTOM_THRESHOLD = 60;
const DEFAULT_TOP_THRESHOLD = 100;
const SUBPIXEL_THRESHOLD = 0.5;

/**
 * Finds the topmost DOM message element intersecting or immediately below the container's top boundary.
 */
export function findViewportAnchorElement(container: HTMLDivElement): { element: HTMLElement; offsetTop: number } | null {
  const containerRect = container.getBoundingClientRect();
  const children = container.querySelectorAll<HTMLElement>('[data-anchor-id], .chat-message, [data-message-id]');

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childRect = child.getBoundingClientRect();
    // Element's bottom is below container's top (i.e. it is visible inside the viewport)
    if (childRect.bottom > containerRect.top + 2) {
      return {
        element: child,
        offsetTop: childRect.top - containerRect.top,
      };
    }
  }

  // Fallback to first child if container is filled
  if (children.length > 0) {
    const first = children[0];
    return {
      element: first,
      offsetTop: first.getBoundingClientRect().top - containerRect.top,
    };
  }

  return null;
}

/**
 * Universal continuous scroll anchor hook for chat message lists.
 * Provides systemic, jitter-free scroll stabilization:
 * 1. Bottom-Pinned Mode: automatically follows streaming text, async layout, and new messages.
 * 2. Visual Anchor Locked Mode: locks screen visual position of the current reading element,
 *    compensating any height mutation (top prepends, streaming appends, image reflows) to 0px delta.
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
}: UseContinuousScrollAnchorOptions): UseContinuousScrollAnchorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  // Active anchor for visual stabilization
  const currentAnchorRef = useRef<{
    element: HTMLElement;
    targetOffsetTop: number;
    containerScrollHeight: number;
    containerScrollTop: number;
  } | null>(null);

  // Gesture & boundary lock to avoid momentum thrashing at the top
  const topBoundaryLockedRef = useRef(false);
  const wasNearTopRef = useRef(false);
  const isInteractingRef = useRef(false);
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNearBottom = useCallback((): boolean => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= bottomThreshold;
  }, [bottomThreshold]);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const markUserInteracting = useCallback(() => {
    isInteractingRef.current = true;
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
    interactionTimeoutRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      interactionTimeoutRef.current = null;
    }, 200);
  }, []);

  const onWheel = useCallback(() => {
    markUserInteracting();
  }, [markUserInteracting]);

  const onTouchMove = useCallback(() => {
    markUserInteracting();
  }, [markUserInteracting]);

  // Capture or update the current visual anchor
  const captureAnchor = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const anchorData = findViewportAnchorElement(container);
    if (anchorData) {
      currentAnchorRef.current = {
        element: anchorData.element,
        targetOffsetTop: anchorData.offsetTop,
        containerScrollHeight: container.scrollHeight,
        containerScrollTop: container.scrollTop,
      };
    } else {
      currentAnchorRef.current = {
        element: container,
        targetOffsetTop: 0,
        containerScrollHeight: container.scrollHeight,
        containerScrollTop: container.scrollTop,
      };
    }
  }, []);

  /**
   * Universal layout compensation pass.
   * Invoked synchronously after every DOM commit / layout update.
   */
  const applyStabilization = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !isActive) return;

    // Mode A: Bottom Pinned
    if (!isUserScrolledUp) {
      container.scrollTop = container.scrollHeight;
      currentAnchorRef.current = null;
      return;
    }

    // Mode B: Visual Anchor Locked
    const anchor = currentAnchorRef.current;
    if (!anchor) return;

    const containerRect = container.getBoundingClientRect();

    if (anchor.element !== container && anchor.element.isConnected) {
      const currentElementTop = anchor.element.getBoundingClientRect().top - containerRect.top;
      const delta = currentElementTop - anchor.targetOffsetTop;

      if (Math.abs(delta) > SUBPIXEL_THRESHOLD) {
        container.scrollTop += delta;
      }
    } else {
      // Fallback: height diff compensation
      const heightDiff = container.scrollHeight - anchor.containerScrollHeight;
      if (heightDiff > 0) {
        container.scrollTop = anchor.containerScrollTop + heightDiff;
      }
    }

    // Refresh anchor state after applying compensation
    captureAnchor();
  }, [captureAnchor, isActive, isUserScrolledUp]);

  // Execute stabilization after every layout flush
  useLayoutEffect(() => {
    applyStabilization();
  });

  // Watch for asynchronous layout changes (images, code highlighting, graphs)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        applyStabilization();
        rafId = null;
      });
    });

    observer.observe(container);
    // Observe children wrapper if present
    const firstChild = container.firstElementChild as HTMLElement | null;
    if (firstChild) {
      observer.observe(firstChild);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [applyStabilization]);

  // Main scroll event handler
  const handleScroll = useCallback(() => {
    if (!isActive) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom();
    const userUp = !nearBottom;
    setIsUserScrolledUp(userUp);

    // If user is scrolled up, continuously refresh the reading anchor
    if (userUp) {
      captureAnchor();
    } else {
      currentAnchorRef.current = null;
    }

    const scrolledNearTop = container.scrollTop < topThreshold;
    if (scrolledNearTop !== wasNearTopRef.current) {
      wasNearTopRef.current = scrolledNearTop;
      onNearTop?.(scrolledNearTop);
    }

    // Top load handling with momentum lock
    if (!allMessagesLoaded && hasMoreMessages && !isLoadingMore) {
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

      // Hard lock before triggering async load
      topBoundaryLockedRef.current = true;
      // Capture anchor state right before fetching
      captureAnchor();

      void onLoadOlder(container).finally(() => {
        // Re-stabilize immediately after load
        applyStabilization();
      });
    }
  }, [
    allMessagesLoaded,
    applyStabilization,
    captureAnchor,
    hasMoreMessages,
    isActive,
    isLoadingMore,
    isNearBottom,
    onLoadOlder,
    onNearTop,
    topThreshold,
  ]);

  // Automatically attach native passive scroll listener to container
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const notifyContentMutating = useCallback(() => {
    if (isUserScrolledUp) {
      captureAnchor();
    }
  }, [captureAnchor, isUserScrolledUp]);

  return {
    scrollContainerRef,
    isUserScrolledUp,
    setIsUserScrolledUp,
    isNearBottom,
    scrollToBottom,
    handleScroll,
    onWheel,
    onTouchMove,
    notifyContentMutating,
  };
}
