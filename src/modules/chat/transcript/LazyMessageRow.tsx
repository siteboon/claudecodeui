import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage } from '@/shared/types';
import type { LazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';

/**
 * Mounts a transcript row's real content only while the row is near the
 * viewport, and swaps it for a fixed-height placeholder otherwise.
 *
 * The transcript renders every loaded message into the DOM, so "Load all" on a
 * long session used to commit tens of thousands of markdown/tool subtrees at
 * once — a gigabyte-scale tab. The wrapper element here always stays in the
 * DOM (carrying the row's `data-message-timestamp`, so search jumps and scroll
 * anchors keep working against unmounted rows), while the expensive subtree
 * exists only inside a band around the viewport.
 *
 * The placeholder reuses the row's last measured height, so scrolling back
 * through previously seen content changes no scroll geometry at all; rows
 * never yet measured use an estimate and rely on browser scroll anchoring
 * while they settle.
 */

/** Placeholder height for rows that have never been measured. */
const ESTIMATED_ROW_HEIGHT_PX = 100;

type LazyMessageRowProps = {
  lazyRows: LazyRowObserver | null;
  /** Mirrors the row's own `data-message-timestamp`, present even while unmounted. */
  timestamp: ChatMessage['timestamp'] | undefined;
  /**
   * Rows near the tail render their content on first commit so the initial
   * scroll-to-bottom measures real heights; everything older starts as a
   * placeholder and mounts when scrolled toward.
   */
  initiallyNearViewport: boolean;
  children: ReactNode;
};

export default function LazyMessageRow({
  lazyRows,
  timestamp,
  initiallyNearViewport,
  children,
}: LazyMessageRowProps) {
  const [isNearViewport, setIsNearViewport] = useState(initiallyNearViewport);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);

  const handleNearViewportChange = useCallback((nextIsNearViewport: boolean) => {
    if (!nextIsNearViewport) {
      // Measured now, while the content is still in the DOM, so the
      // placeholder that replaces it occupies exactly the same space. That
      // includes 0px (a hidden thinking row renders nothing) and fractions of
      // a pixel, which offsetHeight would round: a placeholder taller than the
      // content, on a row just past the band's top edge, reaches back into the
      // band, remounts the content, drops out again, and repeats forever where
      // no scroll anchoring absorbs the shift (Safari).
      const rect = elementRef.current?.getBoundingClientRect();
      // A 0x0 box means the row is not rendered at all (hidden tab), which
      // says nothing about its height, so the last measurement is kept.
      if (rect && (rect.width > 0 || rect.height > 0)) {
        setMeasuredHeight(rect.height);
      }
    }
    setIsNearViewport(nextIsNearViewport);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!lazyRows || !element) return undefined;
    return lazyRows.observe(element, handleNearViewportChange);
  }, [lazyRows, handleNearViewportChange]);

  const isMounted = lazyRows === null || isNearViewport;

  return (
    <div
      ref={elementRef}
      data-message-timestamp={timestamp || undefined}
      style={isMounted ? undefined : { height: measuredHeight ?? ESTIMATED_ROW_HEIGHT_PX }}
    >
      {isMounted ? children : null}
    </div>
  );
}
