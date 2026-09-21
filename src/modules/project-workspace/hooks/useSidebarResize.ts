import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

// Device-local like `quickSettingsHandlePosition`: screen sizes differ per
// device, so the width deliberately does not go through the server-backed
// preference store.
const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 288;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;
// The main pane must keep at least this much room regardless of the sidebar width.
const MIN_MAIN_PANE_WIDTH = 400;
const KEYBOARD_STEP_PX = 16;

// The minimum wins when the viewport is too narrow for both constraints, so a
// stored width never collapses the sidebar below its usable size.
const getMaxSidebarWidth = (): number => {
  if (typeof window === 'undefined') {
    return MAX_SIDEBAR_WIDTH;
  }
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_MAIN_PANE_WIDTH),
  );
};

// Absolute bounds only; the viewport cap is applied on top when rendering.
const clampToBounds = (width: number): number => (
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)))
);

const clampToViewport = (width: number, maxWidth: number): number => (
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, width))
);

// Storage can throw where it is disabled (sandboxed iframes, blocked cookies);
// the sidebar must still render, just without persistence.
const readStoredSidebarWidth = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (saved === null) {
      return DEFAULT_SIDEBAR_WIDTH;
    }

    const parsed = Number(saved);
    if (saved.trim() === '' || !Number.isFinite(parsed)) {
      localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
      return DEFAULT_SIDEBAR_WIDTH;
    }

    return clampToBounds(parsed);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
};

const writeStoredSidebarWidth = (width: number) => {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Persistence is best-effort; the in-memory width still applies.
  }
};

/**
 * Owns the desktop sidebar width for ProjectSidebarRegion: pointer drag on the
 * resize handle, keyboard adjustment, double-click reset, viewport clamping and
 * device-local persistence.
 */
export function useSidebarResize() {
  // The width the user chose (from storage or the last drag/keyboard/reset).
  // Kept separate from what is rendered so a temporarily narrow window only
  // caps the display and growing it back restores this choice.
  const [preferredWidth, setPreferredWidth] = useState<number>(readStoredSidebarWidth);
  // The widest the sidebar may currently be: the absolute max capped so the
  // main pane keeps its minimum. Tracks the viewport so the rendered width and
  // the handle's `aria-valuemax` follow window resizes.
  const [maxWidth, setMaxWidth] = useState<number>(getMaxSidebarWidth);
  // Whether a pointer drag is in progress; drives the handle highlight and the
  // body-wide `col-resize` cursor / text-selection lock.
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidth = clampToViewport(preferredWidth, maxWidth);
  // Mirrors the rendered width so pointer-up can persist the final value and
  // keys can step from it without waiting for a re-render.
  const latestWidthRef = useRef(sidebarWidth);
  const pendingWidthRef = useRef<number | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  // Where inside the handle the drag started, so the first move does not snap
  // the edge to the pointer.
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    latestWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const applyWidth = useCallback((width: number) => {
    const clamped = clampToViewport(clampToBounds(width), getMaxSidebarWidth());
    latestWidthRef.current = clamped;
    setPreferredWidth(clamped);
    return clamped;
  }, []);

  const commitPendingWidth = useCallback(() => {
    frameHandleRef.current = null;
    if (pendingWidthRef.current !== null) {
      applyWidth(pendingWidthRef.current);
      pendingWidthRef.current = null;
    }
  }, [applyWidth]);

  const cancelPendingFrame = useCallback(() => {
    if (frameHandleRef.current !== null) {
      cancelAnimationFrame(frameHandleRef.current);
      frameHandleRef.current = null;
    }
  }, []);

  const finishResize = useCallback(() => {
    cancelPendingFrame();
    // Land on the last position the pointer reached rather than the last frame
    // that happened to commit, then persist once for the whole drag.
    commitPendingWidth();
    setIsResizing(false);
    writeStoredSidebarWidth(latestWidthRef.current);
  }, [cancelPendingFrame, commitPendingWidth]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Only the primary button (or a touch/pen contact) starts a drag.
    if (event.button !== 0) {
      return;
    }
    const container = containerRef.current;
    if (container) {
      dragOffsetRef.current = latestWidthRef.current
        - (event.clientX - container.getBoundingClientRect().left);
    }
    // Capturing keeps move/up events flowing to the handle even when the
    // pointer leaves it (or the window) mid-drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    event.preventDefault();
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // `sidebarWidth` re-renders the sidebar wrapper on every commit, and a
    // high-polling-rate mouse fires several moves per frame, so the width is
    // coalesced to one commit per animation frame.
    pendingWidthRef.current = event.clientX
      - container.getBoundingClientRect().left
      + dragOffsetRef.current;
    if (frameHandleRef.current === null) {
      frameHandleRef.current = requestAnimationFrame(commitPendingWidth);
    }
  }, [commitPendingWidth]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    finishResize();
  }, [finishResize]);

  const handleDoubleClick = useCallback(() => {
    writeStoredSidebarWidth(applyWidth(DEFAULT_SIDEBAR_WIDTH));
  }, [applyWidth]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = latestWidthRef.current - KEYBOARD_STEP_PX;
        break;
      case 'ArrowRight':
        nextWidth = latestWidthRef.current + KEYBOARD_STEP_PX;
        break;
      case 'Home':
        nextWidth = MIN_SIDEBAR_WIDTH;
        break;
      case 'End':
        nextWidth = MAX_SIDEBAR_WIDTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    writeStoredSidebarWidth(applyWidth(nextWidth));
  }, [applyWidth]);

  // Body-wide cursor and selection lock while dragging, so the cursor does not
  // flicker over the sidebar/main content and no text gets selected. Cleanup
  // also runs on unmount mid-drag.
  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Pointer capture normally routes the release to the handle, but if the
    // handle unmounts mid-drag (the sidebar collapses under a second touch or
    // a synced preference) the capture is dropped silently and the release
    // lands elsewhere; catching it on the window ends the drag anyway.
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, finishResize]);

  // Re-cap when the window resizes so the main pane keeps its minimum width.
  // The preference (state and storage) is left alone so growing the window
  // back restores the user's chosen width.
  useEffect(() => {
    const handleWindowResize = () => {
      setMaxWidth(getMaxSidebarWidth());
    };
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      cancelPendingFrame();
    };
  }, [cancelPendingFrame]);

  // Stable so the memoised handle only re-renders when the width or drag state changes.
  const handleProps = useMemo(() => ({
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onDoubleClick: handleDoubleClick,
    onKeyDown: handleKeyDown,
  }), [handlePointerDown, handlePointerMove, handlePointerEnd, handleDoubleClick, handleKeyDown]);

  return {
    sidebarWidth,
    isResizing,
    containerRef,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth,
    handleProps,
  };
}
