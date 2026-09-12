import React from 'react';

import type { PromptEntry } from '@/modules/chat/utils/promptNavigator';
import { cn } from '@/shared/utils';

// The whole gutter is one hover/click target: the cursor's vertical position
// maps to the nearest tick, so tick density never demands pointer precision.
const GUTTER_WIDTH_PX = 28;
// The rail shows at most a window of ticks; hovering the gutter edges
// carousels the window through the rest of the prompts.
const MAX_VISIBLE_TICKS = 30;
const TICK_PITCH_PX = 12;
const EDGE_ZONE_PX = 18;
const CAROUSEL_INTERVAL_MS = 80;
const TICK_OVERSCAN = 4;
// Tick lengths for the proximity wave around the cursor.
const TICK_BASE_WIDTH_PX = 10;
const TICK_ACTIVE_WIDTH_PX = 14;
const TICK_FOCUS_WIDTH_PX = 20;
// The hover preview is a scrolling mini-list of all prompts: the highlighted
// row stays centered while the list glides, and the panel itself is
// interactive so imprecise gutter hits can be corrected inside the list.
const PANEL_ROW_HEIGHT_PX = 54;
const PANEL_ROW_INSET_Y_PX = 4;
const PANEL_MAX_ROWS = 8;
const PANEL_SCROLL_MARGIN_ROWS = 2;
const PANEL_HIDE_DELAY_MS = 160;

// Codex-style wave: the highlighted tick stretches, neighbours taper off.
const PROXIMITY_FALLOFF = [1, 0.6, 0.35, 0.15];

const resolveTickWidth = (
  index: number,
  highlightedIndex: number | null,
  isActive: boolean,
): number => {
  const base = isActive ? TICK_ACTIVE_WIDTH_PX : TICK_BASE_WIDTH_PX;
  if (highlightedIndex === null) {
    return base;
  }
  const distance = Math.abs(index - highlightedIndex);
  const factor = PROXIMITY_FALLOFF[distance] ?? 0;
  return Math.round(base + (TICK_FOCUS_WIDTH_PX - base) * factor);
};

type PromptNavigatorRailProps = {
  prompts: PromptEntry[];
  /** Entry id of the prompt the viewport is currently reading. */
  activeId: string | null;
  onSelect: (entry: PromptEntry) => void;
  canLoadEarlier: boolean;
  isLoadingOlder: boolean;
  onLoadEarlier: () => void;
  /**
   * The transcript's scroll container. The gutter is a pointer-events island
   * over it, so a wheel over the rail would otherwise be swallowed and the
   * transcript could not scroll — and scroll-to-top is what pages in older
   * history. The gutter forwards its wheel here instead.
   */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  loadMoreLabel: string;
  emptyPreviewLabel: string;
  navigatorLabel: string;
};

/**
 * The right-edge prompt navigator: a tape of ticks, one per user prompt, that
 * previews each prompt on hover and jumps the transcript to it on click.
 *
 * Ported from openchamber's `PromptNavigatorRail` (packages/ui/src/components/
 * chat/components/PromptNavigatorRail.tsx): pointer position over the gutter
 * maps to the nearest tick (a wave stretches the tick under the cursor), the
 * gutter carousels through long transcripts when the pointer parks on its
 * edges, and an adjacent panel lists every prompt as a card, gliding so the
 * highlighted row stays centered.
 */
export function PromptNavigatorRail({
  prompts,
  activeId,
  onSelect,
  canLoadEarlier,
  isLoadingOlder,
  onLoadEarlier,
  scrollContainerRef,
  loadMoreLabel,
  emptyPreviewLabel,
  navigatorLabel,
}: PromptNavigatorRailProps) {
  const gutterRef = React.useRef<HTMLDivElement | null>(null);
  // Declared early: the gutter's pointer handlers below must be able to tell
  // whether a pointer event bubbled up from inside the preview panel.
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = React.useState<number | null>(null);
  const [windowStart, setWindowStart] = React.useState(0);

  // The rail floats outside the scroll container, so a wheel over the gutter
  // would scroll nothing; hand the delta to the transcript instead (and let
  // scroll-to-top page in older history from there).
  const handleGutterWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    scrollContainerRef.current?.scrollBy({ top: event.deltaY });
  }, [scrollContainerRef]);

  const visibleCount = Math.min(prompts.length, MAX_VISIBLE_TICKS);
  const maxWindowStart = Math.max(0, prompts.length - visibleCount);
  const clampedWindowStart = Math.min(windowStart, maxWindowStart);
  const windowEnd = clampedWindowStart + visibleCount;
  const hasMoreAbove = clampedWindowStart > 0;
  const hasMoreBelow = windowEnd < prompts.length;

  const activeIndex = React.useMemo(() => {
    if (!activeId) {
      return -1;
    }
    return prompts.findIndex((prompt) => prompt.id === activeId);
  }, [activeId, prompts]);

  // Refs mirroring hot values so the carousel interval reads fresh state.
  const windowStartRef = React.useRef(clampedWindowStart);
  windowStartRef.current = clampedWindowStart;
  const promptsLengthRef = React.useRef(prompts.length);
  promptsLengthRef.current = prompts.length;
  const pointerYRef = React.useRef<number | null>(null);
  const carouselTimerRef = React.useRef<number | null>(null);
  const carouselDirRef = React.useRef<0 | 1 | -1>(0);

  const ensureWindowContains = React.useCallback((index: number) => {
    setWindowStart((start) => {
      const length = promptsLengthRef.current;
      const count = Math.min(length, MAX_VISIBLE_TICKS);
      const maxStart = Math.max(0, length - count);
      const clamped = Math.min(start, maxStart);
      if (index < clamped) {
        return index;
      }
      if (index >= clamped + count) {
        return Math.min(maxStart, index - count + 1);
      }
      return clamped;
    });
  }, []);

  // Load-earlier prepends shift every index; move the window with them so the
  // visible ticks (and the active one) don't jump around.
  const firstIdRef = React.useRef<string | undefined>(prompts[0]?.id);
  const prevLengthRef = React.useRef(prompts.length);
  React.useLayoutEffect(() => {
    const prevFirst = firstIdRef.current;
    const prevLength = prevLengthRef.current;
    const added = prompts.length - prevLength;
    if (added > 0 && prevLength > 0 && prevFirst && prompts[0]?.id !== prevFirst) {
      setWindowStart((start) => start + added);
      setHighlightedIndex((index) => (index === null ? null : index + added));
    }
    firstIdRef.current = prompts[0]?.id;
    prevLengthRef.current = prompts.length;
  }, [prompts]);

  // While the user isn't interacting with the rail, the tape glides so the
  // active prompt stays centered — the scale moves, not the marker.
  React.useEffect(() => {
    if (highlightedIndex !== null) {
      return;
    }
    const target = activeIndex >= 0 ? activeIndex : prompts.length - 1;
    setWindowStart(() => {
      const length = promptsLengthRef.current;
      const count = Math.min(length, MAX_VISIBLE_TICKS);
      const maxStart = Math.max(0, length - count);
      return Math.max(0, Math.min(maxStart, target - Math.floor(count / 2)));
    });
  }, [activeIndex, highlightedIndex, prompts.length]);

  const relativeIndexFromPointer = React.useCallback((clientY: number): number | null => {
    const gutter = gutterRef.current;
    if (!gutter) {
      return null;
    }
    const rect = gutter.getBoundingClientRect();
    const raw = Math.floor((clientY - rect.top) / TICK_PITCH_PX);
    const count = Math.min(promptsLengthRef.current, MAX_VISIBLE_TICKS);
    if (count === 0) {
      return null;
    }
    return Math.max(0, Math.min(count - 1, raw));
  }, []);

  const stopCarousel = React.useCallback(() => {
    carouselDirRef.current = 0;
    if (carouselTimerRef.current !== null) {
      window.clearInterval(carouselTimerRef.current);
      carouselTimerRef.current = null;
    }
  }, []);

  const carouselStep = React.useCallback(() => {
    const dir = carouselDirRef.current;
    if (dir === 0) {
      stopCarousel();
      return;
    }
    const length = promptsLengthRef.current;
    const count = Math.min(length, MAX_VISIBLE_TICKS);
    const maxStart = Math.max(0, length - count);
    const current = Math.min(windowStartRef.current, maxStart);
    const next = Math.max(0, Math.min(maxStart, current + dir));
    if (next === current) {
      stopCarousel();
      return;
    }
    windowStartRef.current = next;
    setWindowStart(next);
    const pointerY = pointerYRef.current;
    if (pointerY !== null) {
      const relative = relativeIndexFromPointer(pointerY);
      if (relative !== null) {
        setHighlightedIndex(Math.min(length - 1, next + relative));
      }
    }
  }, [relativeIndexFromPointer, stopCarousel]);

  const updateCarousel = React.useCallback((clientY: number) => {
    const gutter = gutterRef.current;
    if (!gutter) {
      return;
    }
    const rect = gutter.getBoundingClientRect();
    const y = clientY - rect.top;
    let dir: 0 | 1 | -1 = 0;
    if (y <= EDGE_ZONE_PX && hasMoreAbove) {
      dir = -1;
    } else if (y >= rect.height - EDGE_ZONE_PX && hasMoreBelow) {
      dir = 1;
    }
    carouselDirRef.current = dir;
    if (dir === 0) {
      stopCarousel();
      return;
    }
    if (carouselTimerRef.current === null) {
      carouselTimerRef.current = window.setInterval(carouselStep, CAROUSEL_INTERVAL_MS);
    }
  }, [carouselStep, hasMoreAbove, hasMoreBelow, stopCarousel]);

  React.useEffect(() => () => {
    if (carouselTimerRef.current !== null) {
      window.clearInterval(carouselTimerRef.current);
    }
  }, []);

  // Leaving the gutter hides the panel after a short grace period so the
  // pointer can travel into the panel and interact with the list directly.
  const hideTimerRef = React.useRef<number | null>(null);
  const cancelScheduledHide = React.useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const scheduleHide = React.useCallback(() => {
    cancelScheduledHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setHighlightedIndex(null);
    }, PANEL_HIDE_DELAY_MS);
  }, [cancelScheduledHide]);
  React.useEffect(() => () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
  }, []);

  // Shared by mouse hover and touch scrub: highlight the tick under the
  // pointer and run the edge carousel.
  const applyPointer = React.useCallback((clientY: number) => {
    cancelScheduledHide();
    pointerYRef.current = clientY;
    const relative = relativeIndexFromPointer(clientY);
    if (relative !== null) {
      setHighlightedIndex(
        Math.min(promptsLengthRef.current - 1, windowStartRef.current + relative),
      );
    }
    updateCarousel(clientY);
  }, [cancelScheduledHide, relativeIndexFromPointer, updateCarousel]);

  // The preview panel renders inside the gutter, so its pointer events reach
  // the gutter's handlers by bubbling. The panel's cursor Y projected onto
  // the gutter's scale is meaningless — feeding it to applyPointer fought the
  // panel's own row highlighting (flicker) and could trip the edge carousel
  // (tape auto-scrolling while the pointer was only reading the list). The
  // container's stopPropagation only covers mousemove/click, and these run on
  // pointer events, which sail through it.
  const isInsidePanel = React.useCallback((target: EventTarget | null): boolean => (
    target instanceof Node && panelRef.current !== null && panelRef.current.contains(target)
  ), []);

  const handlePointerLeave = React.useCallback(() => {
    pointerYRef.current = null;
    stopCarousel();
    scheduleHide();
  }, [scheduleHide, stopCarousel]);

  // The pointer is reading the list, not the tape: keep the panel open, but
  // drop the gutter-side pointer state (carousel, last pointer Y) so nothing
  // keeps re-driving the tape from a cursor that left it.
  const handlePanelEnter = React.useCallback(() => {
    cancelScheduledHide();
    pointerYRef.current = null;
    stopCarousel();
  }, [cancelScheduledHide, stopCarousel]);

  /* Touch parity: a finger press on the gutter does what hover does on a
     mouse — wave + preview panel — then drag scrubs the ticks and release
     selects the highlighted one. Pointer events carry both input types; the
     gutter sets `touch-action: none` so the browser delivers the drag as
     pointermove instead of stealing it for transcript scrolling. */
  const scrubbingRef = React.useRef(false);
  const suppressGutterClickRef = React.useRef(false);
  // Fresh-value reads for the scrub-completion callback, which stays stable.
  const highlightedIndexRefForSelect = React.useRef<number | null>(highlightedIndex);
  highlightedIndexRefForSelect.current = highlightedIndex;
  const handleSelectRef = React.useRef<((index: number | null) => void) | null>(null);

  const handleGutterPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isInsidePanel(event.target)) {
      return;
    }
    if (event.pointerType !== 'touch') {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    applyPointer(event.clientY);
  }, [applyPointer, isInsidePanel]);

  const handleGutterPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isInsidePanel(event.target)) {
      // Reading the list keeps the panel open (the row's own onMouseMove
      // owns the highlight) but must not re-derive the tick from the
      // pointer's Y or arm the edge carousel.
      cancelScheduledHide();
      return;
    }
    if (event.pointerType === 'touch') {
      if (scrubbingRef.current) {
        applyPointer(event.clientY);
      }
      return;
    }
    applyPointer(event.clientY);
  }, [applyPointer, cancelScheduledHide, isInsidePanel]);

  const endTouchScrub = React.useCallback((event: React.PointerEvent<HTMLDivElement>, select: boolean) => {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    suppressGutterClickRef.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (select) {
      const index = highlightedIndexRefForSelect.current;
      if (index !== null && handleSelectRef.current) {
        handleSelectRef.current(index);
        return;
      }
    }
    pointerYRef.current = null;
    stopCarousel();
    scheduleHide();
  }, [scheduleHide, stopCarousel]);

  const handleGutterPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => endTouchScrub(event, true),
    [endTouchScrub],
  );
  const handleGutterPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => endTouchScrub(event, false),
    [endTouchScrub],
  );

  const handleSelect = React.useCallback((index: number | null) => {
    if (index === null) {
      return;
    }
    const prompt = prompts[index];
    if (!prompt) {
      return;
    }
    onSelect(prompt);
    stopCarousel();
    setHighlightedIndex(null);
    gutterRef.current?.blur();
  }, [onSelect, prompts, stopCarousel]);
  handleSelectRef.current = handleSelect;

  const handleGutterClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // A touch scrub selects on pointerup; the click synthesized afterwards
    // would select the pointer-up position again (or double-fire elsewhere).
    if (suppressGutterClickRef.current) {
      suppressGutterClickRef.current = false;
      return;
    }
    const relative = relativeIndexFromPointer(event.clientY);
    if (relative === null) {
      return;
    }
    handleSelect(Math.min(prompts.length - 1, windowStartRef.current + relative));
  }, [handleSelect, prompts.length, relativeIndexFromPointer]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (prompts.length === 0) {
      return;
    }
    const current = highlightedIndex ?? (activeIndex >= 0 ? activeIndex : prompts.length - 1);

    const moveTo = (index: number) => {
      const next = Math.max(0, Math.min(prompts.length - 1, index));
      ensureWindowContains(next);
      setHighlightedIndex(next);
    };

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(current + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveTo(prompts.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(current);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setHighlightedIndex(null);
      gutterRef.current?.blur();
    }
  }, [activeIndex, ensureWindowContains, handleSelect, highlightedIndex, prompts.length]);

  const handleBlur = React.useCallback(() => {
    stopCarousel();
    setHighlightedIndex(null);
  }, [stopCarousel]);

  // Wheel over the panel steps the highlight instead of scrolling the chat
  // underneath; a native non-passive listener is required for preventDefault.
  const highlightedIndexRef = React.useRef(highlightedIndex);
  highlightedIndexRef.current = highlightedIndex;
  const isPanelVisible = highlightedIndex !== null;
  const wheelRemainderRef = React.useRef(0);
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      wheelRemainderRef.current += event.deltaY;
      const steps = Math.trunc(wheelRemainderRef.current / PANEL_ROW_HEIGHT_PX);
      if (steps === 0) {
        return;
      }
      wheelRemainderRef.current -= steps * PANEL_ROW_HEIGHT_PX;
      const current = highlightedIndexRef.current;
      if (current === null) {
        return;
      }
      const next = Math.max(0, Math.min(promptsLengthRef.current - 1, current + steps));
      if (next !== current) {
        ensureWindowContains(next);
        setHighlightedIndex(next);
      }
    };
    panel.addEventListener('wheel', handleWheel, { passive: false });
    return () => panel.removeEventListener('wheel', handleWheel);
  }, [ensureWindowContains, isPanelVisible]);

  const highlightedPrompt = highlightedIndex !== null ? prompts[highlightedIndex] : undefined;
  // Panel list geometry: centered on the highlight when the panel opens, then
  // a dead zone — the list only glides when the highlighted row gets within a
  // couple of rows of the window edge, so small pointer moves don't scroll.
  const panelVisibleRows = Math.min(prompts.length, PANEL_MAX_ROWS);
  const panelHeight = panelVisibleRows * PANEL_ROW_HEIGHT_PX;
  const panelMaxOffset = prompts.length * PANEL_ROW_HEIGHT_PX - panelHeight;
  const clampPanelOffset = (offset: number) => Math.max(0, Math.min(panelMaxOffset, offset));
  const panelOffsetRef = React.useRef<number | null>(null);
  let panelScrollOffset = 0;
  if (highlightedIndex === null) {
    panelOffsetRef.current = null;
  } else if (panelOffsetRef.current === null) {
    panelScrollOffset = clampPanelOffset(
      highlightedIndex * PANEL_ROW_HEIGHT_PX - (panelHeight - PANEL_ROW_HEIGHT_PX) / 2,
    );
    panelOffsetRef.current = panelScrollOffset;
  } else {
    let offset = panelOffsetRef.current;
    const highestAllowed = (highlightedIndex - PANEL_SCROLL_MARGIN_ROWS) * PANEL_ROW_HEIGHT_PX;
    const lowestAllowed =
      (highlightedIndex + 1 + PANEL_SCROLL_MARGIN_ROWS) * PANEL_ROW_HEIGHT_PX - panelHeight;
    if (offset > highestAllowed) {
      offset = highestAllowed;
    } else if (offset < lowestAllowed) {
      offset = lowestAllowed;
    }
    panelScrollOffset = clampPanelOffset(offset);
    panelOffsetRef.current = panelScrollOffset;
  }
  // Only rows near the visible window are rendered; extra rows slide in under
  // the mask during the glide instead of popping in at the edges.
  const panelFirstVisibleRow = Math.floor(panelScrollOffset / PANEL_ROW_HEIGHT_PX);
  const panelSliceStart = Math.max(0, panelFirstVisibleRow - TICK_OVERSCAN);
  const panelSliceEnd = Math.min(prompts.length, panelFirstVisibleRow + panelVisibleRows + TICK_OVERSCAN);
  const panelClippedAbove = panelScrollOffset > 0;
  const panelClippedBelow = panelScrollOffset < panelMaxOffset;
  const panelMask = panelClippedAbove || panelClippedBelow
    ? `linear-gradient(to bottom, ${panelClippedAbove ? 'transparent, black 10%' : 'black'}, ${panelClippedBelow ? 'black 90%, transparent' : 'black'})`
    : undefined;
  // Overscan a few ticks beyond the window so they slide in under the gradient
  // mask instead of popping into existence at the edges.
  const overscanStart = Math.max(0, clampedWindowStart - TICK_OVERSCAN);
  const overscanEnd = Math.min(prompts.length, windowEnd + TICK_OVERSCAN);
  const visiblePrompts = prompts.slice(overscanStart, overscanEnd);
  const gutterMask = hasMoreAbove || hasMoreBelow
    ? `linear-gradient(to bottom, ${hasMoreAbove ? 'transparent, black 14%' : 'black'}, ${hasMoreBelow ? 'black 86%, transparent' : 'black'})`
    : undefined;

  if (prompts.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={navigatorLabel}
      // The rail's left edge sits on the message column's right edge: the
      // column wrapper's right:100% anchor pushes the whole gutter outward
      // into the pane margin instead of overlapping the bubbles. On phones
      // there is no pane margin to push into (the column spans the viewport),
      // so it instead sits inside the gutter the column's `max-sm:pr-10`
      // gave up, aligned to the layer's right edge.
      className="pointer-events-none absolute left-full top-1/2 z-20 -translate-y-1/2 pl-1.5 max-sm:left-auto max-sm:right-0 max-sm:pl-0"
    >
      <div className="pointer-events-auto flex flex-col items-end" onWheel={handleGutterWheel}>
        {canLoadEarlier ? (
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              // Nudge so the icon centers over the tick column
              // (ticks sit at right-1 with a 10px base width).
              '-mr-px mb-1.5 flex size-5 shrink-0 items-center justify-center rounded-full',
              'text-gray-400 transition-colors hover:bg-gray-200/60 hover:text-gray-700',
              'dark:hover:bg-gray-700/60 dark:hover:text-gray-200',
              isLoadingOlder ? 'cursor-wait opacity-70' : undefined,
            )}
            aria-label={loadMoreLabel}
            title={loadMoreLabel}
            disabled={isLoadingOlder}
            onClick={(event) => {
              event.stopPropagation();
              if (!isLoadingOlder) {
                onLoadEarlier();
              }
            }}
          >
            {isLoadingOlder ? (
              <span className="block size-3.5 animate-spin rounded-full border-b-2 border-gray-400" />
            ) : (
              <span aria-hidden="true" className="block text-xs leading-none">↑</span>
            )}
          </button>
        ) : null}
        <div
          ref={gutterRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={
            highlightedPrompt ? `prompt-rail-tick-${highlightedPrompt.id}` : undefined
          }
          className="relative cursor-pointer outline-none"
          style={{
            width: `${GUTTER_WIDTH_PX}px`,
            height: `${visibleCount * TICK_PITCH_PX}px`,
            // Touch drags over the gutter scrub the ticks (like mouse hover)
            // instead of panning the transcript; the gutter is a 28px island,
            // so the transcript still scrolls freely everywhere else.
            touchAction: 'none',
          }}
          onMouseLeave={handlePointerLeave}
          onPointerDown={handleGutterPointerDown}
          onPointerMove={handleGutterPointerMove}
          onPointerUp={handleGutterPointerUp}
          onPointerCancel={handleGutterPointerCancel}
          onClick={handleGutterClick}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        >
          <div
            className="absolute inset-0 overflow-hidden"
            style={gutterMask ? { maskImage: gutterMask, WebkitMaskImage: gutterMask } : undefined}
          >
            {/* The tape: ticks keep their absolute position on the strip, and
                the strip itself glides. */}
            <div
              // Remount on prepend so the index shift doesn't play as a
              // spurious slide animation.
              key={prompts[0]?.id}
              className="absolute inset-x-0 top-0 transition-transform duration-300 ease-out"
              style={{ transform: `translateY(-${clampedWindowStart * TICK_PITCH_PX}px)` }}
            >
              {visiblePrompts.map((prompt, slot) => {
                const index = overscanStart + slot;
                const isActive = prompt.id === activeId;
                const isHighlighted = highlightedIndex === index;
                const tickWidth = resolveTickWidth(index, highlightedIndex, isActive);

                return (
                  <div
                    key={prompt.id}
                    id={`prompt-rail-tick-${prompt.id}`}
                    role="option"
                    aria-selected={isHighlighted}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={prompt.preview.trim() || emptyPreviewLabel}
                    className="pointer-events-none absolute right-1 flex items-center justify-end"
                    style={{ top: `${index * TICK_PITCH_PX}px`, height: `${TICK_PITCH_PX}px` }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'block h-0.5 rounded-full transition-all duration-200 ease-out',
                        isActive
                          ? 'bg-gray-900 dark:bg-gray-100'
                          : isHighlighted
                            ? 'bg-gray-900/80 dark:bg-gray-100/80'
                            : 'bg-gray-900/30 dark:bg-gray-100/30',
                      )}
                      style={{ width: `${tickWidth}px` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {highlightedPrompt && highlightedIndex !== null ? (
            <div
              ref={panelRef}
              className={cn(
                'pointer-events-auto absolute right-full top-1/2 z-30 mr-3 -translate-y-1/2',
                'w-[min(20rem,calc(100vw-6rem))] overflow-hidden rounded-xl',
                'border border-gray-200/60 bg-white py-1 shadow-md',
                'dark:border-gray-700/60 dark:bg-gray-800',
              )}
              onMouseEnter={handlePanelEnter}
              onMouseLeave={scheduleHide}
              onMouseMove={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="relative overflow-hidden"
                style={{
                  height: `${panelVisibleRows * PANEL_ROW_HEIGHT_PX}px`,
                  maskImage: panelMask,
                  WebkitMaskImage: panelMask,
                }}
              >
                {/* The list glides so the highlighted row stays centered while
                    scrubbing the rail. */}
                <div
                  className="absolute inset-x-0 top-0 transition-transform duration-200 ease-out"
                  style={{
                    height: `${prompts.length * PANEL_ROW_HEIGHT_PX}px`,
                    transform: `translateY(-${panelScrollOffset}px)`,
                  }}
                >
                  {prompts.slice(panelSliceStart, panelSliceEnd).map((prompt, slot) => {
                    const index = panelSliceStart + slot;
                    const isActive = prompt.id === activeId;
                    const isHighlighted = highlightedIndex === index;
                    return (
                      <div
                        key={prompt.id}
                        role="option"
                        aria-selected={isHighlighted}
                        aria-current={isActive ? 'true' : undefined}
                        className="absolute inset-x-0 cursor-pointer px-1.5"
                        style={{
                          top: `${index * PANEL_ROW_HEIGHT_PX + PANEL_ROW_INSET_Y_PX}px`,
                          height: `${PANEL_ROW_HEIGHT_PX - PANEL_ROW_INSET_Y_PX * 2}px`,
                        }}
                        onMouseMove={() => {
                          cancelScheduledHide();
                          if (highlightedIndexRef.current !== index) {
                            ensureWindowContains(index);
                            setHighlightedIndex(index);
                          }
                        }}
                        onClick={() => handleSelect(index)}
                      >
                        <div
                          className={cn(
                            'flex h-full items-center rounded-lg border px-2 transition-colors',
                            isActive
                              ? 'border-transparent bg-gray-900 dark:bg-gray-100'
                              : isHighlighted
                                ? 'border-gray-200/60 bg-gray-100 dark:border-gray-700/60 dark:bg-gray-700'
                                : 'border-gray-200/40 dark:border-gray-700/40',
                          )}
                        >
                          <span
                            className={cn(
                              // Fill both clamp lines to the edge instead of
                              // leaving a ragged gap before a long next word.
                              'min-w-0 flex-1 line-clamp-2 break-words text-xs leading-snug [overflow-wrap:anywhere]',
                              isActive
                                ? 'text-white dark:text-gray-900'
                                : 'text-gray-500 dark:text-gray-400',
                            )}
                          >
                            {prompt.preview.trim() || emptyPreviewLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
