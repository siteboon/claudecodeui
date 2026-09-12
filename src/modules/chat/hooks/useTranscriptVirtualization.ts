import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import {
  TRANSCRIPT_FULL_RENDER_ROWS,
  TRANSCRIPT_OVERSCAN_PX,
  estimateItemHeightPx,
} from '@/modules/chat/utils/transcriptWindow';
import type { MessageListItem } from '@/modules/chat/utils/toolGrouping';

/** Key under which rendered row heights are cached. Stable rows only. */
export type VirtualizedRowKey = string;

type UseTranscriptVirtualizationArgs = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** The grouped rows the pane renders, in order. */
  items: MessageListItem[];
  /** Pane-level key for each item; the height cache is keyed by it. */
  getKey: (item: MessageListItem, index: number) => string;
  /**
   * Freezes the window on an explicit range while a jump animates to its
   * target: the target's rows must exist (and the rows under the animation
   * must not collapse into a spacer) until the scroll lands. Cleared when
   * the jump completes; the scroll-driven window re-arms from the settled
   * position.
   */
  forcedRange: { start: number; end: number } | null;
  /**
   * Renders everything with no spacers. Test/inspection escape hatch; the
   * jump flow uses forcedRange, not this.
   */
  disabled: boolean;
};

type TranscriptVirtualization = {
  /** Index range of `items` to render, inclusive-exclusive. */
  range: { start: number; end: number };
  /** Spacer heights (px) above and below the rendered slice. */
  spacerHeights: { top: number; bottom: number };
  virtualized: boolean;
  /**
   * Called with each row's element after React commits the slice; measures
   * and caches its height so the window math uses real geometry for any row
   * that has been on screen at least once.
   */
  registerRendered: (element: HTMLDivElement | null, key: VirtualizedRowKey) => void;
};

/**
 * Windowing for the transcript: only the rows inside the viewport band render,
 * and everything above/below collapses into two spacers.
 *
 * The previous scheme kept every loaded row in the DOM as a placeholder — a
 * 1500-row session produced a 1500-node, ~150k-px scroller, and Chrome's
 * compositor gave up painting it: selectable-but-invisible text until the
 * user shook it with a scroll. DOM nodes now track the viewport, not the
 * transcript.
 */
export function useTranscriptVirtualization({
  scrollContainerRef,
  items,
  getKey,
  forcedRange,
  disabled,
}: UseTranscriptVirtualizationArgs): TranscriptVirtualization {
  const heightsRef = useRef(new Map<VirtualizedRowKey, number>());
  // Bumped whenever a row gets newly measured, so the bounds memo recomputes
  // against the freshest cache.
  const [measureVersion, setMeasureVersion] = useState(0);
  // Nothing until the layout pass has measured the scroll position — the
  // first frame of a long transcript renders zero rows plus the spacers
  // rather than the whole list.
  const [range, setRange] = useState({ start: 0, end: 0 });

  // A session switch empties the list before filling it with another
  // transcript's rows; the cache must not outlive its transcript. The key
  // carries the session identity implicitly: an empty list means the old
  // rows are gone.
  const lastNonEmptyRef = useRef(0);
  if (items.length === 0 && lastNonEmptyRef.current > 0) {
    lastNonEmptyRef.current = 0;
    heightsRef.current.clear();
  } else if (items.length > 0) {
    lastNonEmptyRef.current = items.length;
  }

  const virtualized = !disabled && items.length > TRANSCRIPT_FULL_RENDER_ROWS;
  const bounds = useMemo(() => {
    const heights = heightsRef.current;
    const result = new Array<number>(items.length + 1);
    result[0] = 0;
    for (let index = 0; index < items.length; index++) {
      const key = getKey(items[index], index);
      const measured = heights.get(key);
      const height = measured ?? estimateItemHeightPx(items[index]);
      result[index + 1] = result[index] + height;
    }
    return result;
  }, [items, getKey, measureVersion]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const computeRange = useCallback(() => {
    const container = scrollContainerRef.current;
    const list = itemsRef.current;
    const boundsList = boundsRef.current;
    if (!container || list.length === 0) {
      setRange({ start: 0, end: list.length });
      return;
    }
    const scrollTop = container.scrollTop;
    const bandTop = Math.max(0, scrollTop - TRANSCRIPT_OVERSCAN_PX);
    const bandBottom = scrollTop + container.clientHeight + TRANSCRIPT_OVERSCAN_PX;

    // First bound at or after the band edge; steps of ±1 row bracket it so a
    // row straddling the band edge is included.
    const lowerBound = (target: number) => {
      let low = 0;
      let high = boundsList.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (boundsList[mid] < target) low = mid + 1;
        else high = mid;
      }
      return low;
    };
    const start = Math.max(0, lowerBound(bandTop) - 1);
    const end = Math.min(list.length, lowerBound(bandBottom) + 1);
    setRange((previous) => (
      previous.start === start && previous.end === end ? previous : { start, end }
    ));
  }, [scrollContainerRef]);

  useLayoutEffect(() => {
    if (forcedRange) {
      setRange((previous) => (
        previous.start === forcedRange.start && previous.end === forcedRange.end
          ? previous
          : { start: forcedRange.start, end: forcedRange.end }
      ));
      // A jump is animating; re-windowing off the in-flight scroll position
      // would yank rows out from under the animation.
      return undefined;
    }
    if (disabled) {
      setRange((previous) => (
        previous.start === 0 && previous.end === itemsRef.current.length
          ? previous
          : { start: 0, end: itemsRef.current.length }
      ));
      return undefined;
    }
    const container = scrollContainerRef.current;
    if (!container) return undefined;
    computeRange();
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        computeRange();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [computeRange, disabled, forcedRange, items, measureVersion, scrollContainerRef]);

  const registerRendered = useCallback((element: HTMLDivElement | null, key: VirtualizedRowKey) => {
    if (!element) return;
    const height = element.offsetHeight;
    if (height <= 0) return;
    const heights = heightsRef.current;
    if (heights.get(key) === height) return;
    heights.set(key, height);
    setMeasureVersion((current) => current + 1);
  }, []);

  const spacerHeights = virtualized
    ? {
      top: bounds[range.start] ?? 0,
      bottom: Math.max(0, (bounds[items.length] ?? 0) - (bounds[range.end] ?? 0)),
    }
    : { top: 0, bottom: 0 };

  return { range, spacerHeights, virtualized, registerRendered };
}
