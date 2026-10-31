import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';

/** How far beyond the viewport a transcript row keeps (or gains) its mounted content. */
const LAZY_ROW_VIEWPORT_MARGIN_PX = 1200;

/** Every transcript row's wrapper (LazyMessageRow), whether its content is mounted or not. */
const LAZY_ROW_SELECTOR = '[data-lazy-row]';

export type LazyRowObserver = {
  /** Starts watching an element; returns the matching cleanup. */
  observe: (
    element: Element,
    onNearViewportChange: (isNearViewport: boolean) => void,
  ) => () => void;
  /**
   * Called from a row's layout effect while its real content is in the DOM,
   * before the browser paints; `replacedPlaceholder` says this commit swapped
   * it in for a placeholder. Returns the matching cleanup.
   */
  trackMountedRow: (element: Element, replacedPlaceholder: boolean) => () => void;
};

/**
 * The row the view is held still by: the topmost mounted row on screen, with
 * its top in content coordinates (which scrolling does not change).
 */
type ScrollAnchor = {
  row: Element;
  offset: number;
  height: number;
  /**
   * The bottom of the nearest mounted row above the anchor, in content
   * coordinates (-Infinity when there is none): where the stretch above the
   * anchor that holds no mounted row starts. While the view top stays between
   * this and the anchor's bottom, with the anchor still on screen, the anchor
   * is still the topmost mounted row on screen, even with the view top in the
   * gap the column leaves between rows.
   */
  aboveRowBottom: number;
};

/**
 * Where no mounted row is on screen, the stretch of content around the view
 * that holds none, between the nearest mounted rows above and below it (in
 * content coordinates, open-ended where there is none). Scrolling within it
 * cannot bring a row on screen, so it needs no new look at the rows.
 */
type EmptyStretch = { from: number; to: number };

function isUnrendered(rect: DOMRect): boolean {
  // A 0x0 box is a row inside the hidden Chat tab (display: none), which
  // says nothing about its size.
  return rect.width === 0 && rect.height === 0;
}

function hasNativeScrollAnchoring(): boolean {
  return typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('overflow-anchor', 'auto');
}

const noop = () => {};

/**
 * Runs `run` for the first row of a commit only. Every row of a commit is in
 * the DOM before any of its layout effects run, so one run covers them all.
 * Strictly it runs once per task: `doneThisCommit` holds until the next
 * microtask checkpoint, which comes after every row of the commit has run its
 * layout effects. A later commit in the same task is skipped; its rows are
 * covered by the ResizeObserver's first report on them, before paint.
 */
function runOncePerCommit(doneThisCommit: MutableRefObject<boolean>, run: () => void): void {
  if (doneThisCommit.current) return;
  doneThisCommit.current = true;
  queueMicrotask(() => { doneThisCommit.current = false; });
  run();
}

/**
 * For each transcript scroll container anchored manually, the observer's
 * "retake the anchor here" callback. Keyed by element because the writers
 * (useChatSessionState) cannot reach the observer instance ChatMessagesPane
 * creates.
 */
const anchorRetakes = new WeakMap<Element, () => void>();

/**
 * Used by useChatSessionState after each scrollTop write it makes to the
 * transcript that moved the view (scroll to bottom, restores, the tab-return
 * position, search jumps and reveals, the initial settle).
 * Such a write is aimed at the layout as it is now, so the manual anchoring
 * must not add a drift on top of it: the anchor is retaken right here, where
 * the write landed. Anything that changes above the view after this, even a
 * swap committed before the write's scroll event, is then corrected from the
 * writer's position. A write that moved nothing must not be passed here: the
 * layout may already hold a change the ResizeObserver has not reported, and a
 * retake would make it the new baseline. Where the browser anchors natively
 * no retake is registered and this does nothing.
 */
export function noteProgrammaticScroll(container: Element): void {
  anchorRetakes.get(container)?.();
}

/** What a manually anchoring observer hooked onto its scroll container. */
type ContainerListener = { container: HTMLDivElement; listener: () => void; retake: () => void };

/**
 * Unhooks an observer from the container it listened to: its scroll listener,
 * and its retake, unless another observer has registered its own since.
 */
function stopListening({ container, listener, retake }: ContainerListener): void {
  container.removeEventListener('scroll', listener);
  if (anchorRetakes.get(container) === retake) anchorRetakes.delete(container);
}

/** scrollTop clamped to the scrollable range, so iOS rubber-banding is not stored as a position. */
function restingScrollTop(container: HTMLElement): number {
  const maxScrollTop = container.scrollHeight - container.clientHeight;
  return Math.max(0, Math.min(container.scrollTop, maxScrollTop));
}

/**
 * One shared IntersectionObserver for every LazyMessageRow of a transcript,
 * rooted at its scroll container. Returns null where IntersectionObserver does
 * not exist (jsdom), which keeps every row permanently mounted — the
 * pre-existing behavior.
 *
 * Where the browser has no scroll anchoring (Safari before 27), it also keeps
 * what the user is looking at still while content above the viewport changes:
 * rows mounting over a size estimate, rows leaving the visible window, the
 * chrome above the first row. It holds the topmost mounted row on screen in
 * place, as native anchoring would. Browsers that have it are kept off blank
 * estimates by index.css, which gives placeholders (`data-lazy-placeholder`)
 * no width there.
 */
export function useLazyRowObserver(
  scrollContainerRef: RefObject<HTMLDivElement>,
): LazyRowObserver | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbacksRef = useRef(new Map<Element, (isNearViewport: boolean) => void>());
  // Whether this transcript holds the view itself (no native scroll anchoring).
  // Decided once per instance, so the manual path never switches on or off
  // mid-life; IntersectionObserver is needed for any rows to be tracked at all.
  const [anchorsManually] = useState(
    () => typeof IntersectionObserver !== 'undefined' && !hasNativeScrollAnchoring(),
  );
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedChromeRef = useRef(new Set<Element>());
  const mountedRowsRef = useRef(new Set<Element>());
  const anchorRef = useRef<ScrollAnchor | null>(null);
  // Set by a retake that found no mounted row on screen; cleared by the next
  // retake and whenever a row mounts.
  const emptyStretchRef = useRef<EmptyStretch | null>(null);
  // Where the view rested at the last scroll event or anchor retake, within
  // the scrollable range. Only used to tell how far the browser lowered
  // scrollTop on its own when content shrank under the bottom of the view.
  const lastScrollTopRef = useRef(0);
  // Set by the first row of a commit that swaps placeholders in, which holds
  // and retakes the anchor for all of them (runOncePerCommit).
  const anchorHeldThisCommitRef = useRef(false);
  // Set by the first row of a commit that mounts with no anchor to hold, which
  // looks for one among the rows; the rest of the commit's rows would find the
  // same. Separate from the flag above so such a row never skips a swap's hold.
  const anchorSoughtThisCommitRef = useRef(false);
  // Set by the first mounted row of a commit, which looks for new chrome to
  // observe; every row of the commit would find the same.
  const chromeWatchedThisCommitRef = useRef(false);
  const scrollListenerRef = useRef<ContainerListener | null>(null);
  const isSupported = typeof IntersectionObserver !== 'undefined';

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    observedChromeRef.current.clear();
    const scrollListener = scrollListenerRef.current;
    if (scrollListener) stopListening(scrollListener);
    scrollListenerRef.current = null;
  }, []);

  const recordAnchor = useCallback(() => {
    anchorRef.current = null;
    emptyStretchRef.current = null;
    const container = scrollContainerRef.current;
    if (!container) return;
    const viewport = container.getBoundingClientRect();
    if (isUnrendered(viewport)) return;
    lastScrollTopRef.current = restingScrollTop(container);
    let topmost: { row: Element; rect: DOMRect } | null = null;
    // The nearest mounted rows wholly above and below the view, in viewport
    // coordinates.
    let aboveRowBottom = -Infinity;
    let belowRowTop = Infinity;
    for (const row of mountedRowsRef.current) {
      const rect = row.getBoundingClientRect();
      // A row that renders nothing (a hidden thinking row) never straddles
      // the top, so as the anchor it would be retaken on every scroll event,
      // and native anchoring skips boxes with no area: when it starts
      // rendering, the row below it is the one that stays put.
      if (rect.height === 0) continue;
      if (rect.bottom <= viewport.top) {
        aboveRowBottom = Math.max(aboveRowBottom, rect.bottom);
      } else if (rect.top >= viewport.bottom) {
        belowRowTop = Math.min(belowRowTop, rect.top);
      } else if (!topmost || rect.top < topmost.rect.top) {
        topmost = { row, rect };
      }
    }
    const toContent = (viewportY: number) => viewportY - viewport.top + container.scrollTop;
    if (!topmost) {
      emptyStretchRef.current = { from: toContent(aboveRowBottom), to: toContent(belowRowTop) };
      return;
    }
    anchorRef.current = {
      row: topmost.row,
      offset: toContent(topmost.rect.top),
      height: topmost.rect.height,
      aboveRowBottom: toContent(aboveRowBottom),
    };
  }, [scrollContainerRef]);

  // Moves the view by however far the anchor moved within the content since
  // it was taken, so everything that changed above it stays out of sight.
  const holdAnchor = useCallback(() => {
    const container = scrollContainerRef.current;
    const anchor = anchorRef.current;
    if (!container || !anchor?.row.isConnected) return;
    const viewport = container.getBoundingClientRect();
    const rect = anchor.row.getBoundingClientRect();
    if (isUnrendered(viewport) || isUnrendered(rect)) return;
    const { scrollTop } = container;
    // A writer's move (scroll to bottom, a restore, a jump) already retook the
    // anchor where it landed (noteProgrammaticScroll). Any other change to
    // scrollTop since the anchor was taken is the user, possibly mid-scroll
    // with its scroll event still to come (Safari scrolls the pane
    // asynchronously), so the drift is added to where the view is now. The
    // exception is the browser lowering scrollTop because content shrank
    // under the bottom of the view: that already moved the view by part of
    // the shrink, so the correction starts from where it rested.
    const restingTop = lastScrollTopRef.current;
    const clampedByBrowser = scrollTop < restingTop
      && scrollTop >= container.scrollHeight - container.clientHeight - 1;
    const fromScrollTop = clampedByBrowser ? restingTop : scrollTop;
    // At the very top there is nothing above to hide a change in, so
    // something appearing there (the older-messages spinner) stays seen.
    if (fromScrollTop <= 0) return;
    // The anchor's move within the content, which scrolling does not change.
    const drift = rect.top - viewport.top + scrollTop - anchor.offset;
    const target = fromScrollTop + drift;
    // Rounding noise is not worth a write: touching scrollTop is not free
    // during an iOS momentum scroll.
    if (Math.abs(target - scrollTop) >= 0.5) container.scrollTop = target;
  }, [scrollContainerRef]);

  // Everything that resizes content around the view after a commit: late
  // images, markdown settling, rows added or dropped, the chrome above the
  // first row. ResizeObserver delivers after layout and before paint, so the
  // shift and its correction land in the same frame.
  const handleResize = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (isUnrendered(container.getBoundingClientRect())) {
      anchorRef.current = null;
      emptyStretchRef.current = null;
      return;
    }
    holdAnchor();
    recordAnchor();
  }, [scrollContainerRef, holdAnchor, recordAnchor]);

  // Mostly just remembers where the view rests. A retake reads every mounted
  // row's box, so it is skipped while it would find what the last one found:
  // `anchorStillTopmost` (the view top is between the bottom of the mounted
  // row above the anchor and the anchor's bottom, and the anchor is still on
  // screen) or `stillNoRowOnScreen` (no mounted row was on screen, and the
  // view is still inside the stretch that holds none). Row mounts and resize
  // reports retake anyway, and so does a writer's move, at the write itself.
  // Otherwise the anchor is retaken; that reads layout, which may already hold
  // a change the ResizeObserver has not reported, so the anchor is held first,
  // or the new baseline would swallow the change.
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, clientHeight } = container;
    const anchor = anchorRef.current;
    const emptyStretch = emptyStretchRef.current;
    const anchorStillTopmost = anchor !== null
      && scrollTop >= anchor.aboveRowBottom
      && scrollTop < anchor.offset + anchor.height
      && anchor.offset < scrollTop + clientHeight;
    const stillNoRowOnScreen = anchor === null
      && emptyStretch !== null
      && scrollTop >= emptyStretch.from
      && scrollTop + clientHeight <= emptyStretch.to;
    if (anchorStillTopmost || stillNoRowOnScreen) {
      lastScrollTopRef.current = restingScrollTop(container);
      return;
    }
    holdAnchor();
    recordAnchor();
  }, [scrollContainerRef, holdAnchor, recordAnchor]);

  const observe = useCallback<LazyRowObserver['observe']>((element, onNearViewportChange) => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((observerEntries) => {
        for (const entry of observerEntries) {
          // A zero-sized rect means the row is inside a display:none subtree
          // (the Chat tab is hidden), not that the user scrolled away — keep
          // the row's state, and its recorded height, intact. Where
          // placeholders take no width, one measured at 0px reports the same,
          // and is already unmounted, so skipping it changes nothing either.
          // Elsewhere (Safari before 27) it keeps its width, so its report is
          // delivered: it only stores the same 0px and the same "far" again.
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

  // Starts listening to the container's scroll events, and registers the
  // retake the writers' notes call (noteProgrammaticScroll) for it. Rows mount
  // before the container's ref is attached on the first commit, so this runs
  // both from every row (it is one comparison once attached) and once the
  // hook's effect runs.
  const listenToContainer = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || scrollListenerRef.current?.container === container) return;
    const previous = scrollListenerRef.current;
    if (previous) stopListening(previous);
    container.addEventListener('scroll', handleScroll, { passive: true });
    anchorRetakes.set(container, recordAnchor);
    scrollListenerRef.current = { container, listener: handleScroll, retake: recordAnchor };
  }, [scrollContainerRef, handleScroll, recordAnchor]);

  // Watches the chrome above the first row, which lives in the pane's sticky
  // header and in the rows' column. Each is observed once, since observing
  // again starts a fresh observation, and dropped once React replaces it.
  // This queries the DOM, so the rows run it once per commit.
  const observeChrome = useCallback(() => {
    const container = scrollContainerRef.current;
    const resizeObserver = resizeObserverRef.current;
    if (!container || !resizeObserver) return;
    const observedChrome = observedChromeRef.current;
    for (const target of observedChrome) {
      if (target.isConnected) continue;
      resizeObserver.unobserve(target);
      observedChrome.delete(target);
    }
    const firstRow = container.querySelector(LAZY_ROW_SELECTOR);
    for (const target of [firstRow?.parentElement, ...Array.from(container.children)]) {
      if (!target || observedChrome.has(target)) continue;
      observedChrome.add(target);
      resizeObserver.observe(target);
    }
  }, [scrollContainerRef]);

  useEffect(() => {
    if (!anchorsManually) return;
    listenToContainer();
    observeChrome();
    if (!anchorRef.current) recordAnchor();
  }, [anchorsManually, listenToContainer, observeChrome, recordAnchor]);

  const trackMountedRow = useCallback<LazyRowObserver['trackMountedRow']>((element, replacedPlaceholder) => {
    if (!anchorsManually) return noop;
    if (!resizeObserverRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(handleResize);
    }
    // Placeholders change size only when they swap, which this call handles,
    // so only mounted rows are watched; rows leaving the DOM show up as the
    // column resizing.
    resizeObserverRef.current?.observe(element);
    mountedRowsRef.current.add(element);
    // This row may be on screen where no mounted row was.
    emptyStretchRef.current = null;
    listenToContainer();
    runOncePerCommit(chromeWatchedThisCommitRef, observeChrome);

    // The first row of a commit acts for all of it, and the rows after it only
    // register (a retake reads every mounted row's box, so per-row retakes
    // cost a long "Load all" commit rows times mounted rows). The
    // ResizeObserver's first report on each of them retakes the anchor among
    // all of them before paint.
    if (replacedPlaceholder) {
      runOncePerCommit(anchorHeldThisCommitRef, () => {
        holdAnchor();
        recordAnchor();
      });
    } else if (!anchorRef.current) {
      runOncePerCommit(anchorSoughtThisCommitRef, recordAnchor);
    }

    return () => {
      mountedRowsRef.current.delete(element);
      resizeObserverRef.current?.unobserve(element);
      if (anchorRef.current?.row === element) anchorRef.current = null;
    };
  }, [anchorsManually, handleResize, listenToContainer, observeChrome, holdAnchor, recordAnchor]);

  // Identity-stable so each row's effects run once, not per render.
  return useMemo(
    () => (isSupported ? { observe, trackMountedRow } : null),
    [isSupported, observe, trackMountedRow],
  );
}
