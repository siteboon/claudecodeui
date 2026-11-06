import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

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
  /**
   * The scrolling transcript container, used to emulate scroll anchoring on
   * browsers that lack it (Safari): height changes above the viewport shift
   * its scrollTop so the reading position does not jump.
   */
  scrollContainerRef: RefObject<HTMLDivElement>;
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
  scrollContainerRef,
  timestamp,
  initiallyNearViewport,
  children,
}: LazyMessageRowProps) {
  /**
   * Touch devices and browsers without scroll anchoring mount every row
   * unconditionally. The placeholder↔content swap shifts scroll geometry;
   * without native anchoring to absorb it — and with momentum scrolling that
   * JS scrollTop writes would only interrupt — the reading position jumps
   * and flickers. The windowed message list still bounds how many rows exist.
   *
   * The same flag gates the ResizeObserver compensation below. It must NOT
   * trust the overflowAnchor style probe alone: WebKit exposes the property
   * without performing anchoring (iOS Safari drifts with the compensation
   * off). Coarse-pointer devices are always compensated; desktop Chrome
   * (fine pointer, real anchoring) is not, so the emulation never stacks on
   * the native mechanism there.
   */
  const [needsAnchorCompensation] = useState(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    const coarsePointer = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    const noScrollAnchoring = !('overflowAnchor' in document.documentElement.style);
    return coarsePointer || noScrollAnchoring;
  });
  const alwaysMounted = needsAnchorCompensation;
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
    if (!lazyRows || !element || alwaysMounted) return undefined;
    return lazyRows.observe(element, handleNearViewportChange);
  }, [lazyRows, handleNearViewportChange, alwaysMounted]);

  /**
   * Emulates scroll anchoring where the browser has none (Safari) — and only
   * there, because stacking it on Chrome's native anchoring double-compensates
   * every height change. When this row's height changes while the whole row
   * sits above the viewport's top edge (media settling), everything below it
   * is pushed down and the reading position jumps; shifting scrollTop by the
   * height delta keeps the same content on screen. The pre-change bottom
   * (rect.bottom - delta) decides, so a row straddling the top edge never
   * yanks the view. A 0x0 rect means a hidden tab, not a resize; the baseline
   * is kept.
   */
  useEffect(() => {
    const element = elementRef.current;
    const container = scrollContainerRef.current;
    if (!element || !container || !needsAnchorCompensation) return undefined;
    if (typeof ResizeObserver === 'undefined') return undefined;

    let lastHeight = element.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const delta = rect.height - lastHeight;
      lastHeight = rect.height;
      if (delta === 0) return;
      if (rect.bottom - delta <= container.getBoundingClientRect().top) {
        container.scrollTop += delta;
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollContainerRef, needsAnchorCompensation]);

  const isMounted = alwaysMounted || lazyRows === null || isNearViewport;

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
