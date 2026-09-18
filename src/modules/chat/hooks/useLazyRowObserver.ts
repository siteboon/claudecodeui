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
 * One shared IntersectionObserver for every LazyMessageRow of a transcript,
 * rooted at its scroll container. Returns null where IntersectionObserver does
 * not exist (jsdom), which keeps every row permanently mounted — the
 * pre-existing behavior.
 */
export function useLazyRowObserver(
  scrollContainerRef: RefObject<HTMLDivElement>,
): LazyRowObserver | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbacksRef = useRef(new Map<Element, (isNearViewport: boolean) => void>());
  const isSupported = typeof IntersectionObserver !== 'undefined';

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

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
    return () => {
      callbacksRef.current.delete(element);
      observerRef.current?.unobserve(element);
    };
  }, [scrollContainerRef]);

  // Identity-stable so each row's observe effect runs once, not per render.
  return useMemo(() => (isSupported ? { observe } : null), [isSupported, observe]);
}
