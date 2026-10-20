import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

/** How far beyond the viewport a transcript row keeps (or gains) its mounted content. */
const LAZY_ROW_VIEWPORT_MARGIN_PX = 1200;

export type LazyRowObserver = {
  /** Starts watching an element; returns the matching cleanup. */
  observe: (
    element: Element,
    onNearViewportChange: (isNearViewport: boolean) => void,
  ) => () => void;
};

/**
 * Whether the browser itself keeps the visible content still when something
 * above the viewport changes height (CSS scroll anchoring). Safari only has it
 * from version 27.
 */
function hasNativeScrollAnchoring(): boolean {
  return typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('overflow-anchor', 'auto');
}

/** Sorts elements into document order. */
function compareDocumentPosition(first: Element, second: Element): number {
  return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * One shared IntersectionObserver for every LazyMessageRow of a transcript,
 * rooted at its scroll container. Returns null where IntersectionObserver does
 * not exist (jsdom), which keeps every row permanently mounted — the
 * pre-existing behavior.
 *
 * Rows settle their real height only once they are near the viewport: a lazy
 * row swaps its 100px estimate for its content 1200px before it scrolls into
 * view. Where the browser has no scroll anchoring to absorb that (Safari
 * before 27), every row settling above the viewport moved the transcript
 * under the reader while they scrolled up (#1574), so there one shared
 * ResizeObserver does it instead. (That is also why `.chat-message` has no
 * `content-visibility`: its estimate resolved only once a row was already on
 * screen, too late to tell from a real change.)
 */
export function useLazyRowObserver(
  scrollContainerRef: RefObject<HTMLDivElement>,
): LazyRowObserver | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbacksRef = useRef(new Map<Element, (isNearViewport: boolean) => void>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  /** Each watched row's last laid-out height, which the next resize is measured against. */
  const rowHeightsRef = useRef(new Map<Element, number>());
  const isSupported = typeof IntersectionObserver !== 'undefined';
  const keepsReadingPosition = typeof ResizeObserver !== 'undefined' && !hasNativeScrollAnchoring();

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  /**
   * Scrolls by however much the rows above the viewport changed height, so the
   * content in view stays where it was. ResizeObserver reports after layout
   * and before paint, so the shift is never drawn; one scroll write per frame
   * keeps an iOS momentum scroll from being interrupted once per row.
   */
  const holdReadingPosition = useCallback((entries: ResizeObserverEntry[]) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    // Document order, so each row is judged by where it sat before this
    // frame, once the rows above it have been compensated for.
    const rows = entries.map((entry) => entry.target).sort(compareDocumentPosition);
    let shift = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      // A 0x0 box is a hidden Chat tab, not a row that collapsed: keep the
      // last height so showing the tab again moves nothing.
      if (rect.width === 0 && rect.height === 0) continue;

      const previousHeight = rowHeightsRef.current.get(row);
      rowHeightsRef.current.set(row, rect.height);
      if (previousHeight === undefined) continue;

      // Only a row that was wholly above the viewport. One reaching into it
      // changes where the reader can see it (a reply streaming in, a tool
      // result opened), so it is left alone, as scroll anchoring leaves it.
      if (rect.top - shift + previousHeight <= containerTop) {
        shift += rect.height - previousHeight;
      }
    }

    if (shift !== 0) {
      container.scrollTop += shift;
    }
  }, [scrollContainerRef]);

  const observe = useCallback<LazyRowObserver['observe']>((element, onNearViewportChange) => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((observerEntries) => {
        for (const entry of observerEntries) {
          // A zero-sized rect means the row is inside a display:none subtree
          // (the Chat tab is hidden), not that the user scrolled away — keep
          // the row's state, and its recorded height, intact.
          if (
            !entry.isIntersecting
            && entry.boundingClientRect.width === 0
            && entry.boundingClientRect.height === 0
          ) {
            continue;
          }
          callbacksRef.current.get(entry.target)?.(entry.isIntersecting);
        }
      }, {
        root: scrollContainerRef.current,
        rootMargin: `${LAZY_ROW_VIEWPORT_MARGIN_PX}px 0px`,
      });
    }

    callbacksRef.current.set(element, onNearViewportChange);
    observerRef.current.observe(element);

    if (keepsReadingPosition) {
      if (!resizeObserverRef.current) {
        resizeObserverRef.current = new ResizeObserver(holdReadingPosition);
      }
      // The height the row was committed with. Its first resize report can
      // arrive after it already settled (an image or a highlighted code block
      // a frame later), and that settling has to count as a change too.
      // Prepended rows are already in place here: the scroll restore that
      // accompanies a prepend runs after the rows' own layout effects.
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        rowHeightsRef.current.set(element, rect.height);
      }
      resizeObserverRef.current.observe(element);
    }

    return () => {
      callbacksRef.current.delete(element);
      observerRef.current?.unobserve(element);
      rowHeightsRef.current.delete(element);
      resizeObserverRef.current?.unobserve(element);
    };
  }, [holdReadingPosition, keepsReadingPosition, scrollContainerRef]);

  // Identity-stable so each row's observe effect runs once, not per render.
  return useMemo(() => (isSupported ? { observe } : null), [isSupported, observe]);
}
