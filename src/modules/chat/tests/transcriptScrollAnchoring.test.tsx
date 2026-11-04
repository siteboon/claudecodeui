import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useLayoutEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';

import { noteProgrammaticScroll, useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }) } },
}));

/**
 * Where the browser has no scroll anchoring (Safari before 27), the transcript
 * keeps what the user is looking at still while content above the viewport
 * changes height; elsewhere it leaves that to the browser. jsdom has no
 * layout, so these tests stack the rows in a small layout model and assert on
 * where a visible row lands.
 */

class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    StubIntersectionObserver.instances.push(this);
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

class StubResizeObserver {
  static instances: StubResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observed = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }
}

const VIEWPORT_HEIGHT = 600;

/**
 * `plain` rows render content without a `.chat-message`, which the prepend
 * restore in useChatSessionState anchors to, so it skips them.
 */
type RowSpec = { id: string; contentHeight: number; mounted: boolean; plain?: boolean };

/**
 * Lays rows out top to bottom below a chrome block, like the pane does: a
 * row's height is its placeholder's inline height while unmounted and its
 * content's height while mounted, with `gap` between rows (the column's
 * space-y). The scroll container sits at y = 0.
 */
function installLayout(
  container: HTMLElement,
  chrome: HTMLElement,
  contentHeights: Map<string, number>,
  { clamp = false, overscroll = false, gap = 0 } = {},
) {
  let scrollTop = 0;
  let scrollTopWrites = 0;
  let rowBoxReads = 0;
  let hidden = false;
  // With `clamp`, scrollTop stays within the content the way a browser keeps
  // it: a write past either end lands on the end, and content shrinking under
  // the bottom of the view pulls scrollTop down with it. `overscroll` lets a
  // write land past the end, the way iOS rubber-bands, until the next layout.
  const maxScrollTop = () => Math.max(0, contentHeight() - VIEWPORT_HEIGHT);
  const clamped = (value: number) => (clamp ? Math.max(0, Math.min(value, maxScrollTop())) : value);
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = overscroll ? value : clamped(value); scrollTopWrites += 1; },
  });
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => contentHeight() });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT_HEIGHT });
  const rect = (top: number, height: number) => (
    hidden
      ? ({ top: 0, bottom: 0, height: 0, width: 0 }) as DOMRect
      : ({ top, bottom: top + height, height, width: 800 }) as DOMRect
  );
  const chromeHeight = () => parseFloat(chrome.style.height || '0');
  const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-message-timestamp]'));
  const rowHeight = (row: HTMLElement) => (
    row.style.height !== ''
      ? parseFloat(row.style.height)
      : contentHeights.get(row.dataset.messageTimestamp ?? '') ?? 0
  );
  const contentHeight = () => {
    const laidOut = rows();
    return chromeHeight()
      + laidOut.reduce((sum, row) => sum + rowHeight(row), 0)
      + gap * Math.max(0, laidOut.length - 1);
  };
  const rowTop = (target: HTMLElement) => {
    let top = chromeHeight() - scrollTop;
    for (const [index, row] of rows().entries()) {
      if (index > 0) top += gap;
      if (row === target) return top;
      top += rowHeight(row);
    }
    throw new Error('row not laid out');
  };

  container.getBoundingClientRect = () => rect(0, VIEWPORT_HEIGHT);
  chrome.getBoundingClientRect = () => rect(-scrollTop, chromeHeight());
  const layOut = () => {
    scrollTop = clamped(scrollTop);
    for (const row of rows()) {
      const box = () => rect(rowTop(row), rowHeight(row));
      row.getBoundingClientRect = () => {
        rowBoxReads += 1;
        return box();
      };
      // The row's content fills it; the prepend restore measures this one.
      const content = row.querySelector<HTMLElement>('.chat-message');
      if (content) content.getBoundingClientRect = box;
    }
  };
  layOut();

  return {
    layOut,
    topOf: (id: string) => rowTop(container.querySelector<HTMLElement>(`[data-message-timestamp="${id}"]`)!),
    row: (id: string) => container.querySelector<HTMLElement>(`[data-message-timestamp="${id}"]`)!,
    setHidden: (value: boolean) => { hidden = value; },
    scrollTopWrites: () => scrollTopWrites,
    /** Every read of a laid-out row's box, which is what retaking the anchor costs. */
    rowBoxReads: () => rowBoxReads,
  };
}

type TranscriptProps = { rows: RowSpec[]; chromeHeight?: number; isActive?: boolean };

function TranscriptPane({
  scrollContainerRef,
  rows,
  chromeHeight,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  rows: RowSpec[];
  chromeHeight: number;
}) {
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    <div ref={scrollContainerRef} data-testid="pane">
      <div data-testid="column">
        <div data-testid="chrome" style={{ height: `${chromeHeight}px` }} />
        {rows.map((row) => (
          <LazyMessageRow
            key={row.id}
            lazyRows={lazyRows}
            timestamp={row.id}
            initiallyNearViewport={row.mounted}
          >
            {row.plain ? <span>{row.id}</span> : <div className="chat-message">{row.id}</div>}
          </LazyMessageRow>
        ))}
      </div>
    </div>
  );
}

function Transcript({ rows, chromeHeight = 0 }: TranscriptProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return <TranscriptPane scrollContainerRef={scrollContainerRef} rows={rows} chromeHeight={chromeHeight} />;
}

// One observer's rows, for several observers on one scroll container.
function ObservedRows({ scrollContainerRef, rows }: { scrollContainerRef: React.RefObject<HTMLDivElement>; rows: RowSpec[] }) {
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    <>
      {rows.map((row) => (
        <LazyMessageRow key={row.id} lazyRows={lazyRows} timestamp={row.id} initiallyNearViewport={row.mounted}>
          <div className="chat-message">{row.id}</div>
        </LazyMessageRow>
      ))}
    </>
  );
}

// A scroll container two observers hook onto, each with rows of its own;
// either can be taken away.
function SharedPane({ first, second }: { first: RowSpec[] | null; second: RowSpec[] | null }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollContainerRef} data-testid="pane">
      <div data-testid="column">
        <div data-testid="chrome" />
        {first && <ObservedRows scrollContainerRef={scrollContainerRef} rows={first} />}
        {second && <ObservedRows scrollContainerRef={scrollContainerRef} rows={second} />}
      </div>
    </div>
  );
}

// The session state the transcript scrolls with, wired as in ChatInterface:
// its restore effect runs in the commit after the rows' layout effects. No
// session is selected, so it never follows or settles on its own; the tests
// call its writers.
const sessionStore = {
  fetchFromServer: vi.fn(async () => null),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(async () => ({ slot: null, deferred: false })),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn(() => []),
  getSessionSlot: vi.fn(() => undefined),
};
const statusCheckSentAtRef = { current: new Map<string, number>() };
const lastSeqRef = { current: new Map<string, number>() };
const resetStreamingState = () => {};
const sendMessage = () => {};
const renderedSession: { current: ReturnType<typeof useChatSessionState> | null } = { current: null };

function SessionTranscript({ rows, chromeHeight = 0, isActive = true }: TranscriptProps) {
  const session = useChatSessionState({
    isActive,
    selectedProject: null,
    selectedSession: null,
    ws: null,
    sendMessage,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore: sessionStore as never,
  });
  useLayoutEffect(() => { renderedSession.current = session; });
  return <TranscriptPane scrollContainerRef={session.scrollContainerRef} rows={rows} chromeHeight={chromeHeight} />;
}

function setup(
  rows: RowSpec[],
  { chromeHeight = 0, scrollTop = 0, clamp = false, overscroll = false, gap = 0, withSession = false } = {},
) {
  const contentHeights = new Map(rows.map((row) => [row.id, row.contentHeight]));
  const Component = withSession ? SessionTranscript : Transcript;
  let props: Required<TranscriptProps> = { rows, chromeHeight, isActive: true };
  const utils = render(<Component {...props} />);
  const pane = utils.getByTestId('pane');
  const chrome = utils.getByTestId('chrome');
  const layout = installLayout(pane, chrome, contentHeights, { clamp, overscroll, gap });
  // A scroll event; the session state's own listener sets state from it.
  const fireScroll = () => act(() => { pane.dispatchEvent(new Event('scroll')); });
  // The user scrolling there, which the browser reports with a scroll event.
  const scrollTo = (top: number) => {
    pane.scrollTop = top;
    layout.layOut();
    fireScroll();
  };
  scrollTo(scrollTop);
  const resizeObserver = StubResizeObserver.instances[0];
  const intersectionObserver = StubIntersectionObserver.instances[0];

  // What the browser reports for every observed element right after observe(),
  // and later for those of `targets` that changed size. Like the browser, it
  // says nothing about an element nobody observes.
  const reportResize = (targets: Element[]) => {
    layout.layOut();
    if (!resizeObserver) return;
    const observed = targets.filter((target) => resizeObserver.observed.has(target));
    if (observed.length === 0) return;
    act(() => {
      resizeObserver.callback(
        observed.map((target) => ({ target }) as ResizeObserverEntry),
        resizeObserver as unknown as ResizeObserver,
      );
    });
  };
  reportResize(Array.from(resizeObserver?.observed ?? []));

  // The IntersectionObserver's report on rows, without its own act, so a test
  // can put it in the same commit as other changes.
  const deliverIntersection = (ids: string[], isIntersecting: boolean) => {
    intersectionObserver.callback(
      ids.map((id) => {
        const target = layout.row(id);
        return { target, isIntersecting, boundingClientRect: target.getBoundingClientRect() } as unknown as IntersectionObserverEntry;
      }),
      intersectionObserver as unknown as IntersectionObserver,
    );
  };
  const reportIntersection = (id: string, isIntersecting: boolean) => {
    act(() => deliverIntersection([id], isIntersecting));
    layout.layOut();
  };
  const bringNear = (id: string) => reportIntersection(id, true);
  const sendFar = (id: string) => reportIntersection(id, false);

  // A commit that changes which rows exist, with no layout pass of its own:
  // called inside a test's act, it shares that commit with other changes, and
  // the test lays out afterwards.
  const commitRows = (nextRows: RowSpec[], nextChromeHeight = props.chromeHeight, isActive = props.isActive) => {
    for (const row of nextRows) contentHeights.set(row.id, row.contentHeight);
    props = { rows: nextRows, chromeHeight: nextChromeHeight, isActive };
    utils.rerender(<Component {...props} />);
  };
  // The same commit, then laid out the way the browser would.
  const commitAndLayOutRows = (nextRows: RowSpec[], nextChromeHeight = props.chromeHeight) => {
    commitRows(nextRows, nextChromeHeight);
    layout.layOut();
  };
  const setActive = (isActive: boolean) => {
    commitRows(props.rows, props.chromeHeight, isActive);
    layout.layOut();
  };
  const session = () => {
    if (!renderedSession.current) throw new Error('rendered without session state');
    return renderedSession.current;
  };

  return {
    ...utils,
    pane,
    chrome,
    layout,
    contentHeights,
    reportResize,
    bringNear,
    sendFar,
    deliverIntersection,
    scrollTo,
    fireScroll,
    commitRows,
    commitAndLayOutRows,
    setActive,
    session,
  };
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  // A browser without scroll anchoring (Safari before 27), where the
  // transcript corrects the view itself.
  vi.stubGlobal('CSS', { supports: () => false });
});

afterEach(() => {
  renderedSession.current = null;
  StubIntersectionObserver.instances = [];
  StubResizeObserver.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('transcript scroll anchoring', () => {
  it('keeps the view still when a never-measured row mounts above it', () => {
    // "old" is a 100px estimate entirely above the viewport; its content is 420px.
    const { layout, bringNear, pane } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 450 });
    const before = layout.topOf('visible');

    bringNear('old');

    expect(pane.scrollTop).toBe(450 + 320);
    expect(layout.topOf('visible')).toBe(before);
  });

  it('absorbs a shrinking row too, so short tool rows do not pull the view up', () => {
    const { layout, bringNear } = setup([
      { id: 'tool', contentHeight: 24, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 350 });
    const before = layout.topOf('visible');

    bringNear('tool');

    expect(layout.topOf('visible')).toBe(before);
  });

  it('does not touch scrollTop when a row remounts at its measured height', () => {
    // Every remount of an already-seen row; a needless write is not free
    // during an iOS momentum scroll.
    const { layout, bringNear, sendFar } = setup([
      { id: 'seen', contentHeight: 420, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 500 });
    sendFar('seen');
    const writesBefore = layout.scrollTopWrites();

    bringNear('seen');

    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('treats a placeholder straddling the top edge as above the view', () => {
    // What a prepend restore leaves behind: the newest prepended row is still
    // a placeholder and pokes 10px into the viewport above the anchor row.
    const { layout, bringNear } = setup([
      { id: 'prepended', contentHeight: 1000, mounted: false },
      { id: 'anchor', contentHeight: 200, mounted: true },
    ], { scrollTop: 90 });
    const before = layout.topOf('anchor');

    bringNear('prepended');

    expect(layout.topOf('anchor')).toBe(before);
  });

  it('lets a row that mounts inside the viewport push what is below it', () => {
    const { layout, bringNear, pane } = setup([
      { id: 'top', contentHeight: 200, mounted: true },
      { id: 'fresh', contentHeight: 400, mounted: false },
      { id: 'below', contentHeight: 200, mounted: true },
    ]);

    bringNear('fresh');

    expect(pane.scrollTop).toBe(0);
    expect(layout.topOf('below')).toBe(600);
  });

  it('measures each row of one resize batch from where it was before the batch', () => {
    // Both rows sit above the viewport; after the batch, "second" has been
    // pushed down past the viewport top by "first"'s growth.
    const { layout, reportResize, contentHeights } = setup([
      { id: 'first', contentHeight: 100, mounted: true },
      { id: 'second', contentHeight: 100, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 250 });
    const before = layout.topOf('visible');

    contentHeights.set('first', 900);
    contentHeights.set('second', 300);
    reportResize([layout.row('second'), layout.row('first')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('keeps the top of a row the user is reading when it grows', () => {
    const { layout, reportResize, contentHeights, pane } = setup([
      { id: 'reading', contentHeight: 400, mounted: true },
      { id: 'below', contentHeight: 200, mounted: true },
    ], { scrollTop: 100 });

    contentHeights.set('reading', 700);
    reportResize([layout.row('reading')]);

    expect(pane.scrollTop).toBe(100);
    expect(layout.topOf('reading')).toBe(-100);
  });

  it('keeps the view still when the chrome above the first row changes while scrolled away', () => {
    const { layout, reportResize, chrome, getByTestId } = setup([
      { id: 'first', contentHeight: 500, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { chromeHeight: 40, scrollTop: 300 });
    const before = layout.topOf('visible');

    // The load-all pill fading out of the flow.
    chrome.style.height = '0px';
    reportResize([getByTestId('column')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('leaves chrome changes alone while the user is looking at them', () => {
    const { layout, reportResize, chrome, getByTestId, pane } = setup([
      { id: 'first', contentHeight: 500, mounted: true },
    ], { chromeHeight: 0 });

    chrome.style.height = '44px';
    reportResize([getByTestId('column')]);

    expect(pane.scrollTop).toBe(0);
    expect(layout.topOf('first')).toBe(44);
  });

  it('ignores the zero rects a hidden tab reports, then picks up where it was', () => {
    const { layout, reportResize, pane } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 350 });

    layout.setHidden(true);
    reportResize([layout.row('above'), layout.row('visible')]);
    layout.setHidden(false);
    reportResize([layout.row('above'), layout.row('visible')]);

    expect(pane.scrollTop).toBe(350);
  });

  it('does not count a mount twice when the ResizeObserver then reports the swapped row', () => {
    const { layout, bringNear, reportResize } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 450 });
    const before = layout.topOf('visible');

    bringNear('old');
    reportResize([layout.row('old')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('keeps the view as still as the top allows when chrome partly on screen collapses', () => {
    const { layout, reportResize, chrome, getByTestId, pane } = setup([
      { id: 'first', contentHeight: 1000, mounted: true },
    ], { chromeHeight: 40, scrollTop: 20, clamp: true });

    chrome.style.height = '0px';
    reportResize([getByTestId('column')]);

    expect(pane.scrollTop).toBe(0);
    expect(layout.topOf('first')).toBe(0);
  });

  it('credits the scroll the browser already took back when content above shrinks at the bottom', () => {
    // 980px of content in a 600px view, scrolled to the end (380). Shrinking
    // the chrome by 48px makes the browser clamp scrollTop to 332 on its own,
    // which already keeps every row where it was.
    const { layout, reportResize, chrome, getByTestId } = setup([
      { id: 'first', contentHeight: 500, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ], { chromeHeight: 80, scrollTop: 380, clamp: true });
    const before = layout.topOf('visible');

    chrome.style.height = '32px';
    reportResize([getByTestId('column')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('adds the rest of the correction when the clamp absorbed only part of a shrink', () => {
    // 30px above the end: the clamp takes 18px of the 48px shrink.
    const { layout, reportResize, chrome, getByTestId } = setup([
      { id: 'first', contentHeight: 500, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ], { chromeHeight: 80, scrollTop: 350, clamp: true });
    const before = layout.topOf('visible');

    chrome.style.height = '32px';
    reportResize([getByTestId('column')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('keeps the view still when the top row leaves the window', () => {
    // The visible window is the last N messages, so a new message drops the
    // oldest row while the user reads further down.
    const rows = [
      { id: 'oldest', contentHeight: 120, mounted: true },
      { id: 'next', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 300, mounted: true },
    ];
    const { layout, reportResize, commitAndLayOutRows, getByTestId } = setup(rows, { scrollTop: 500 });
    const before = layout.topOf('visible');

    commitAndLayOutRows(rows.slice(1));
    reportResize([getByTestId('column')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('keeps the view still when a row mounted from the start appears above it', () => {
    // Not a swap: the row's first commit renders its content, so its layout
    // effect only registers it, and the ResizeObserver's first report on it
    // is what holds the view.
    const { layout, reportResize, commitAndLayOutRows } = setup([
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'tail', contentHeight: 1000, mounted: true },
    ], { scrollTop: 350 });
    const before = layout.topOf('visible');

    commitAndLayOutRows([
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'inserted', contentHeight: 500, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'tail', contentHeight: 1000, mounted: true },
    ]);
    reportResize([layout.row('inserted')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('keeps the view still when a row above it remounts under a new key', () => {
    const { layout, reportResize, commitAndLayOutRows, bringNear, getByTestId } = setup([
      { id: 'grouped', contentHeight: 400, mounted: true },
      { id: 'visible', contentHeight: 300, mounted: true },
    ], { scrollTop: 450 });
    const before = layout.topOf('visible');

    // A regrouping changes the row's key: it comes back as a 100px estimate.
    commitAndLayOutRows([
      { id: 'regrouped', contentHeight: 400, mounted: false },
      { id: 'visible', contentHeight: 300, mounted: true },
    ]);
    reportResize([getByTestId('column')]);
    expect(layout.topOf('visible')).toBe(before);

    bringNear('regrouped');
    expect(layout.topOf('visible')).toBe(before);
  });

  it('corrects a growth the ResizeObserver has not reported when a scroll retakes the anchor', () => {
    const { layout, scrollTo, reportResize, contentHeights } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'b', contentHeight: 300, mounted: true },
      { id: 'c', contentHeight: 300, mounted: true },
    ], { scrollTop: 350 });
    const before = layout.topOf('b');

    // An image settles above the view, and in the same frame the user's
    // scroll moves the anchor ('a') off the top, before the ResizeObserver
    // reports the growth.
    contentHeights.set('above', 500);
    scrollTo(350 + 260);
    reportResize([layout.row('above')]);

    expect(layout.topOf('b')).toBe(before - 260);
  });

  describe('jump to bottom after "Load all"', () => {
    // scrollToBottomAndReset: scrollTop = scrollHeight, then the window shrinks
    // back to the newest messages in the same task. The jump owns where the
    // view lands, whichever of the scroll event and the ResizeObserver comes
    // first in the next frame.
    const jumpToBottomAndShrink = () => {
      const rows = [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, contentHeight: 1000, mounted: true }));
      const utils = setup(rows, { scrollTop: 3500, clamp: true });
      utils.pane.scrollTop = 1e9;
      noteProgrammaticScroll(utils.pane);
      // 3000px left in a 600px view: the bottom is 2400.
      utils.commitAndLayOutRows(rows.slice(2));
      return utils;
    };

    it('ends at the bottom when the scroll event runs first', () => {
      const { pane, reportResize, getByTestId } = jumpToBottomAndShrink();

      pane.dispatchEvent(new Event('scroll'));
      reportResize([getByTestId('column')]);

      expect(pane.scrollTop).toBe(2400);
    });

    it('ends at the bottom when the ResizeObserver runs first', () => {
      const { pane, reportResize, getByTestId } = jumpToBottomAndShrink();

      reportResize([getByTestId('column')]);
      pane.dispatchEvent(new Event('scroll'));

      expect(pane.scrollTop).toBe(2400);
    });

    it('ends at the bottom through the session state\'s own scroll to the bottom', () => {
      const rows = [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, contentHeight: 1000, mounted: true }));
      const { pane, reportResize, commitAndLayOutRows, fireScroll, session, getByTestId } = setup(rows, {
        scrollTop: 3500,
        clamp: true,
        withSession: true,
      });

      act(() => session().scrollToBottom());
      commitAndLayOutRows(rows.slice(2));
      fireScroll();
      reportResize([getByTestId('column')]);

      expect(pane.scrollTop).toBe(2400);
    });
  });

  it('still holds the view when a row mounts above it mid-scroll, before the scroll event', () => {
    // Safari scrolls the pane asynchronously (trackpad, iOS momentum), so
    // scrollTop can move before its scroll event fires; a swap committed in
    // between must still be corrected, relative to where the view now is.
    const { layout, bringNear, pane } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'below', contentHeight: 1000, mounted: true },
    ], { scrollTop: 450 });
    pane.scrollTop = 520;
    layout.layOut();
    const before = layout.topOf('visible');

    bringNear('old');

    expect(pane.scrollTop).toBe(520 + 320);
    expect(layout.topOf('visible')).toBe(before);
  });

  it('still holds the view when content above grows mid-scroll, before the scroll event', () => {
    const { layout, reportResize, contentHeights, pane } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'below', contentHeight: 1000, mounted: true },
    ], { scrollTop: 350 });
    pane.scrollTop = 330;
    layout.layOut();
    const before = layout.topOf('visible');

    contentHeights.set('above', 500);
    reportResize([layout.row('above')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  it('applies no drift on top of a position a writer set against the new layout', () => {
    const { layout, reportResize, contentHeights, pane } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'b', contentHeight: 300, mounted: true },
      { id: 'c', contentHeight: 300, mounted: true },
    ], { scrollTop: 350 });

    // An image settles above the view, and before anything reports it a
    // writer (a jump, a restore) puts the view where it wants it, reading the
    // layout that already has the growth.
    contentHeights.set('above', 500);
    layout.layOut();
    pane.scrollTop = 900;
    noteProgrammaticScroll(pane);
    layout.layOut();
    pane.dispatchEvent(new Event('scroll'));
    reportResize([layout.row('above')]);

    expect(pane.scrollTop).toBe(900);
  });

  it('holds the view for a row swapped in after a writer moved it, before the write\'s scroll event', () => {
    // An IntersectionObserver task already queued when the writer ran commits
    // its swap before the browser fires the write's scroll event. The anchor
    // was retaken where the write landed, so the swap is corrected from there.
    const { layout, bringNear, pane } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'below', contentHeight: 1000, mounted: true },
    ], { scrollTop: 450 });

    pane.scrollTop = 600;
    noteProgrammaticScroll(pane);
    layout.layOut();
    const before = layout.topOf('visible');
    bringNear('old');

    expect(pane.scrollTop).toBe(600 + 320);
    expect(layout.topOf('visible')).toBe(before);
  });

  it('holds the view for a row swapped in after the session state\'s own scroll to the bottom', () => {
    // The same, through a writer in useChatSessionState: its note reaches the
    // observer ChatMessagesPane created for the same pane.
    const { layout, bringNear, pane, session } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'gap', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'below', contentHeight: 1000, mounted: true },
    ], { scrollTop: 450, clamp: true, withSession: true });

    act(() => session().scrollToBottom());
    expect(pane.scrollTop).toBe(1200);
    const before = layout.topOf('below');
    bringNear('old');

    expect(pane.scrollTop).toBe(1200 + 320);
    expect(layout.topOf('below')).toBe(before);
  });

  it('holds and retakes the anchor once for a commit that swaps several rows in', () => {
    const { layout, pane, deliverIntersection } = setup([
      { id: 'p1', contentHeight: 400, mounted: false },
      { id: 'p2', contentHeight: 400, mounted: false },
      { id: 'p3', contentHeight: 400, mounted: false },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'tail', contentHeight: 1000, mounted: true },
    ], { scrollTop: 350 });
    const before = layout.topOf('visible');
    const writesBefore = layout.scrollTopWrites();
    // Every retake of the anchor reads each mounted row's box once.
    const tailReads = vi.spyOn(layout.row('tail'), 'getBoundingClientRect');

    act(() => deliverIntersection(['p1', 'p2', 'p3'], true));
    layout.layOut();

    expect(layout.topOf('visible')).toBe(before);
    expect(pane.scrollTop).toBe(350 + 3 * 300);
    expect(layout.scrollTopWrites()).toBe(writesBefore + 1);
    expect(tailReads).toHaveBeenCalledTimes(1);
  });

  it('stops listening and correcting once the transcript unmounts', () => {
    const { layout, pane, unmount, contentHeights } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ], { scrollTop: 350 });
    const removeListener = vi.spyOn(pane, 'removeEventListener');
    const resizeObserver = StubResizeObserver.instances[0];

    unmount();
    const writesBefore = layout.scrollTopWrites();
    contentHeights.set('above', 900);
    pane.dispatchEvent(new Event('scroll'));
    resizeObserver.callback(
      [{ target: pane } as unknown as ResizeObserverEntry],
      resizeObserver as unknown as ResizeObserver,
    );

    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('keeps the retake of the observer that hooked onto the pane last when an earlier one unhooks', () => {
    // A writer's note reaches whichever observer registered for the pane
    // last; an earlier one unhooking must not take that registration with it,
    // and one that unhooked leaves nothing behind for a note to run.
    const first = [{ id: 'a1', contentHeight: 400, mounted: true }, { id: 'a2', contentHeight: 400, mounted: true }];
    const second = [{ id: 'b1', contentHeight: 400, mounted: true }, { id: 'b2', contentHeight: 400, mounted: true }];
    const contentHeights = new Map([...first, ...second].map((row) => [row.id, row.contentHeight]));
    const utils = render(<SharedPane first={first} second={null} />);
    utils.rerender(<SharedPane first={first} second={second} />);
    const pane = utils.getByTestId('pane');
    const layout = installLayout(pane, utils.getByTestId('chrome'), contentHeights);
    pane.scrollTop = 200;
    layout.layOut();

    utils.rerender(<SharedPane first={null} second={second} />);
    layout.layOut();
    const readsBefore = layout.rowBoxReads();
    noteProgrammaticScroll(pane);
    expect(layout.rowBoxReads()).toBeGreaterThan(readsBefore);

    utils.rerender(<SharedPane first={null} second={null} />);
    const paneBoxReads = vi.spyOn(pane, 'getBoundingClientRect');
    noteProgrammaticScroll(pane);
    expect(paneBoxReads).not.toHaveBeenCalled();
  });

  it('writes nothing when the top row leaves the window while the tab is hidden, or on return', () => {
    const rows = [
      { id: 'oldest', contentHeight: 120, mounted: true },
      { id: 'next', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 300, mounted: true },
    ];
    const { layout, reportResize, commitAndLayOutRows, getByTestId } = setup(rows, { scrollTop: 500 });
    const writesBefore = layout.scrollTopWrites();

    layout.setHidden(true);
    reportResize([getByTestId('column')]);
    commitAndLayOutRows(rows.slice(1));
    reportResize([getByTestId('column')]);
    expect(layout.scrollTopWrites()).toBe(writesBefore);

    layout.setHidden(false);
    reportResize([getByTestId('column')]);
    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('writes nothing for a prepend at the very top', () => {
    const rows = [
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ];
    const { layout, reportResize, commitAndLayOutRows, getByTestId } = setup(rows, { chromeHeight: 40 });
    const writesBefore = layout.scrollTopWrites();

    commitAndLayOutRows([{ id: 'new', contentHeight: 900, mounted: false }, ...rows], 0);
    reportResize([getByTestId('column')]);

    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('writes nothing for a prepend while the tab is hidden, or on return', () => {
    const rows = [
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ];
    const { layout, reportResize, commitAndLayOutRows, getByTestId } = setup(rows, { scrollTop: 350 });
    const writesBefore = layout.scrollTopWrites();

    layout.setHidden(true);
    reportResize([getByTestId('column')]);
    commitAndLayOutRows([{ id: 'new', contentHeight: 900, mounted: false }, ...rows]);
    reportResize([getByTestId('column')]);
    layout.setHidden(false);
    reportResize([getByTestId('column')]);

    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('treats a repeated far report on a placeholder as a no-op', () => {
    const { layout, sendFar, reportResize, getByTestId } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'visible', contentHeight: 400, mounted: true },
    ], { scrollTop: 150 });
    const writesBefore = layout.scrollTopWrites();
    const before = layout.topOf('visible');

    sendFar('old');
    sendFar('old');
    reportResize([getByTestId('column')]);

    expect(layout.row('old').style.height).toBe('100px');
    expect(layout.topOf('visible')).toBe(before);
    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('writes nothing for rows mounted on the first commit', () => {
    const prototypeWrites = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    const { layout, pane } = setup([
      { id: 'a', contentHeight: 400, mounted: true },
      { id: 'b', contentHeight: 400, mounted: true },
      { id: 'c', contentHeight: 400, mounted: true },
    ], { scrollTop: 500 });

    // The one write is the harness's own scroll to 500.
    expect(prototypeWrites).not.toHaveBeenCalled();
    expect(layout.scrollTopWrites()).toBe(1);
    expect(pane.scrollTop).toBe(500);
  });

  it('never anchors to a row that renders nothing', () => {
    // A hidden thinking row has no height. Tied for the top of the view with
    // the row under it, it would be retaken on every scroll event, since a
    // box with no height never straddles the top edge.
    const { layout, scrollTo, reportResize, contentHeights, chrome, getByTestId } = setup([
      { id: 'thinking', contentHeight: 0, mounted: true },
      { id: 'visible', contentHeight: 1000, mounted: true },
      { id: 'below', contentHeight: 1000, mounted: true },
    ], { chromeHeight: 100, scrollTop: 50 });

    // The thinking row starts rendering (show thinking) with both at the top
    // of the view: the view stays on 'visible', as native anchoring does,
    // which skips boxes with no area.
    const onScreen = layout.topOf('visible');
    contentHeights.set('thinking', 200);
    reportResize([layout.row('thinking')]);
    expect(layout.topOf('visible')).toBe(onScreen);
    contentHeights.set('thinking', 0);
    reportResize([layout.row('thinking')]);
    const writesBefore = layout.scrollTopWrites();

    for (const top of [120, 130, 140]) scrollTo(top);
    // Only the user's own scrolls.
    expect(layout.scrollTopWrites()).toBe(writesBefore + 3);

    const before = layout.topOf('visible');
    chrome.style.height = '160px';
    reportResize([getByTestId('column')]);
    expect(layout.topOf('visible')).toBe(before);
  });

  it('corrects the next change after a writer\'s move and its scroll event', () => {
    const { layout, pane, fireScroll, reportResize, contentHeights } = setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'b', contentHeight: 300, mounted: true },
      { id: 'c', contentHeight: 300, mounted: true },
    ], { scrollTop: 350 });

    // A small move by a writer, which the anchor 'a' still straddles, then its
    // scroll event, which finds the anchor the write retook still current.
    pane.scrollTop = 360;
    noteProgrammaticScroll(pane);
    fireScroll();
    const before = layout.topOf('b');

    contentHeights.set('above', 500);
    reportResize([layout.row('above')]);

    expect(layout.topOf('b')).toBe(before);
  });

  it('holds the view for each of two swap commits in a row', async () => {
    const { layout, bringNear, pane } = setup([
      { id: 'p1', contentHeight: 400, mounted: false },
      { id: 'p2', contentHeight: 400, mounted: false },
      { id: 'visible', contentHeight: 400, mounted: true },
      { id: 'tail', contentHeight: 1000, mounted: true },
    ], { scrollTop: 350 });
    const before = layout.topOf('visible');

    bringNear('p2');
    // The next commit is a later task, with no ResizeObserver report between.
    await Promise.resolve();
    bringNear('p1');

    expect(pane.scrollTop).toBe(350 + 2 * 300);
    expect(layout.topOf('visible')).toBe(before);
  });

  it('starts a correction from the end of the content, not from where a rubber-band took the view', () => {
    // 980px of content in a 600px view: the end is 380. iOS lets scrollTop
    // run past it while rubber-banding, and reports that with a scroll event.
    const { layout, pane, fireScroll, reportResize, chrome, getByTestId } = setup([
      { id: 'first', contentHeight: 500, mounted: true },
      { id: 'visible', contentHeight: 400, mounted: true },
    ], { chromeHeight: 80, scrollTop: 380, clamp: true, overscroll: true });
    const before = layout.topOf('visible');
    pane.scrollTop = 410;
    fireScroll();

    // The band settles as content above shrinks by 48px under the bottom.
    chrome.style.height = '32px';
    reportResize([getByTestId('column')]);

    expect(layout.topOf('visible')).toBe(before);
  });

  describe('reading row boxes only when the anchor may have changed', () => {
    it('keeps the anchor without reading rows while the view top sits in the gap above it', () => {
      // The column spaces rows apart (space-y), so the view top can rest
      // between two rows, above the anchor.
      const { layout, scrollTo, reportResize, contentHeights, layout: { scrollTopWrites } } = setup([
        { id: 'above', contentHeight: 300, mounted: true },
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'b', contentHeight: 300, mounted: true },
        { id: 'c', contentHeight: 1000, mounted: true },
      ], { gap: 16 });
      // 'above' ends at 300 and 'a' starts at 316.
      scrollTo(308);
      const before = layout.topOf('a');
      const readsBefore = layout.rowBoxReads();
      const writesBefore = scrollTopWrites();

      for (const top of [312, 304, 330, 301]) scrollTo(top);
      expect(layout.rowBoxReads()).toBe(readsBefore);
      expect(scrollTopWrites()).toBe(writesBefore + 4);

      // Still anchored to 'a', so growth above is held.
      contentHeights.set('above', 500);
      reportResize([layout.row('above')]);
      expect(layout.topOf('a')).toBe(before - 301 + 308);
    });

    it('lets go of an anchor scrolled below the view across placeholders', () => {
      // Nothing mounted lies between 'top' and 'a', so scrolling up keeps
      // 'a' the topmost mounted row only while it is still on screen.
      const placeholders = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `p${n}`, contentHeight: 400, mounted: false }));
      const { pane, scrollTo, bringNear } = setup([
        { id: 'top', contentHeight: 300, mounted: true },
        ...placeholders,
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'tail', contentHeight: 1000, mounted: true },
      ], { scrollTop: 1150 });

      // Only placeholders on screen now, 'a' below the view.
      scrollTo(350);
      // One of them mounts in view: no row on screen is held, so it grows down.
      bringNear('p3');

      expect(pane.scrollTop).toBe(350);
    });

    it('reads no rows on scroll while none can be on screen, and anchors again once one can', () => {
      const { layout, scrollTo, reportResize, chrome, getByTestId } = setup([
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'b', contentHeight: 300, mounted: true },
      ], { chromeHeight: 2000 });
      // Only the chrome above the first row is on screen.
      scrollTo(100);
      const readsBefore = layout.rowBoxReads();

      for (const top of [200, 150, 1400]) scrollTo(top);
      expect(layout.rowBoxReads()).toBe(readsBefore);

      // 'a' comes on screen at 2000 - 300.
      scrollTo(1700);
      const before = layout.topOf('a');
      chrome.style.height = '2100px';
      reportResize([getByTestId('column')]);
      expect(layout.topOf('a')).toBe(before);
    });

    it('retakes the anchor once the view top moves up into the mounted row above it', () => {
      const { layout, scrollTo, reportResize, contentHeights, pane } = setup([
        { id: 'above', contentHeight: 300, mounted: true },
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'b', contentHeight: 300, mounted: true },
        { id: 'c', contentHeight: 1000, mounted: true },
      ], { scrollTop: 350 });

      // From inside 'a' up into 'above', which is now the topmost row on
      // screen; it grows downward, so nothing moves.
      scrollTo(250);
      contentHeights.set('above', 500);
      reportResize([layout.row('above')]);

      expect(pane.scrollTop).toBe(250);
      expect(layout.topOf('above')).toBe(-250);
    });

    it('keeps the resting position current on scrolls that read no rows', () => {
      // 980px of content in a 600px view, at the end (380). A small scroll up
      // keeps 'first' the anchor; the 48px shrink then clamps scrollTop to
      // 332, and the correction must start from 370, not from the end.
      const { layout, scrollTo, reportResize, chrome, getByTestId } = setup([
        { id: 'first', contentHeight: 500, mounted: true },
        { id: 'visible', contentHeight: 400, mounted: true },
      ], { chromeHeight: 80, scrollTop: 380, clamp: true });
      const readsBefore = layout.rowBoxReads();
      scrollTo(370);
      expect(layout.rowBoxReads()).toBe(readsBefore);
      const before = layout.topOf('visible');

      chrome.style.height = '32px';
      reportResize([getByTestId('column')]);

      expect(layout.topOf('visible')).toBe(before);
    });

    it('anchors again once a mounted row above the empty stretch comes on screen', () => {
      const placeholders = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `p${n}`, contentHeight: 400, mounted: false }));
      const { layout, scrollTo, reportResize, chrome, getByTestId } = setup([
        { id: 'top', contentHeight: 300, mounted: true },
        ...placeholders,
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'tail', contentHeight: 1000, mounted: true },
      ], { chromeHeight: 100, scrollTop: 1150 });

      // Only placeholders on screen (400 to 1200 holds no mounted row).
      scrollTo(450);
      // Up until 'top' (100 to 400) is on screen again.
      scrollTo(350);
      const before = layout.topOf('top');
      chrome.style.height = '150px';
      reportResize([getByTestId('column')]);

      expect(layout.topOf('top')).toBe(before);
    });

    describe('a view top exactly at the end of a mounted row', () => {
      // 'above' ends at 300, so a view top there has 'a' as its topmost row.
      const rows = [
        { id: 'above', contentHeight: 300, mounted: true },
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'b', contentHeight: 1000, mounted: true },
      ];

      it('anchors to the next row when it starts there', () => {
        const { layout, reportResize, contentHeights } = setup(rows, { scrollTop: 300 });

        contentHeights.set('above', 500);
        reportResize([layout.row('above')]);

        expect(layout.topOf('a')).toBe(0);
      });

      it('anchors to the next row when a scroll reaches it from inside the row', () => {
        const { layout, scrollTo, reportResize, contentHeights } = setup(rows, { scrollTop: 250 });

        scrollTo(300);
        contentHeights.set('above', 500);
        reportResize([layout.row('above')]);

        expect(layout.topOf('a')).toBe(0);
      });
    });

    it('looks for new chrome to observe once, not once per row, when a commit mounts rows', async () => {
      const { pane, commitAndLayOutRows } = setup([
        { id: 'first', contentHeight: 300, mounted: true },
      ], { scrollTop: 100 });
      await Promise.resolve();
      const chromeLookups = vi.spyOn(pane, 'querySelector');

      commitAndLayOutRows([
        { id: 'first', contentHeight: 300, mounted: true },
        ...[1, 2, 3, 4, 5].map((n) => ({ id: `new-${n}`, contentHeight: 300, mounted: true })),
      ]);

      expect(chromeLookups.mock.calls.filter(([selector]) => selector === '[data-lazy-row]')).toHaveLength(1);
    });

    it('scans once, not once per row, when a commit mounts rows with no anchor', async () => {
      const { layout, commitAndLayOutRows, scrollTo, reportResize, chrome, getByTestId } = setup([
        { id: 'first', contentHeight: 300, mounted: true },
      ], { chromeHeight: 2000, scrollTop: 100 });
      // The next commit is a later task, so the microtask that ends this
      // commit's once-per-commit flags has run by then.
      await Promise.resolve();
      const readsBefore = layout.rowBoxReads();

      commitAndLayOutRows([
        { id: 'first', contentHeight: 300, mounted: true },
        ...[1, 2, 3, 4, 5].map((n) => ({ id: `new-${n}`, contentHeight: 300, mounted: true })),
      ]);
      // Every scan reads 'first'; the rows of the commit are not laid out yet.
      expect(layout.rowBoxReads() - readsBefore).toBe(1);

      scrollTo(1800);
      const before = layout.topOf('first');
      chrome.style.height = '2100px';
      reportResize([getByTestId('column')]);
      expect(layout.topOf('first')).toBe(before);
    });
  });

  describe('prepends', () => {
    it('holds the view for rows put in front of the first one with no restore', () => {
      // Export's loadFullTranscript grows the store, and a show-thinking
      // regroup re-keys rows, with no restore in useChatSessionState.
      const rows = [
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'visible', contentHeight: 200, mounted: true },
      ];
      const { layout, reportResize, commitAndLayOutRows, getByTestId } = setup(rows, { chromeHeight: 40, scrollTop: 350 });
      const before = layout.topOf('visible');

      commitAndLayOutRows([{ id: 'new', contentHeight: 900, mounted: false }, ...rows], 0);
      reportResize([getByTestId('column')]);

      expect(layout.topOf('visible')).toBe(before);
    });

    it('does not re-correct an older page the session state restored', () => {
      const rows = [
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'visible', contentHeight: 200, mounted: true },
      ];
      const { layout, reportResize, commitRows, pane, session, getByTestId } = setup(rows, {
        chromeHeight: 40,
        scrollTop: 350,
        withSession: true,
      });
      const before = layout.topOf('visible');

      // The restore is captured before the rows are put in front, and moves
      // the view itself in the commit that puts them there.
      act(() => {
        session().loadEarlierMessages();
        commitRows([{ id: 'new', contentHeight: 900, mounted: false }, ...rows], 0);
      });
      expect(pane.scrollTop).toBe(350 + 60);
      reportResize([getByTestId('column')]);

      expect(layout.topOf('visible')).toBe(before);
    });

    it('counts a row swapped in once when the restore lands in the same commit', () => {
      // The row's own layout effect holds the view before the restore effect
      // (an ancestor's) runs, so the restore measures its anchor already held.
      const rows = [
        { id: 'p', contentHeight: 400, mounted: false },
        { id: 'a', contentHeight: 300, mounted: true },
        { id: 'visible', contentHeight: 300, mounted: true },
        { id: 'tail', contentHeight: 1000, mounted: true },
      ];
      const { layout, reportResize, commitRows, deliverIntersection, pane, session, getByTestId } = setup(rows, {
        scrollTop: 450,
        withSession: true,
      });
      const before = layout.topOf('visible');

      act(() => {
        session().loadEarlierMessages();
        commitRows([{ id: 'older', contentHeight: 500, mounted: false }, ...rows]);
        deliverIntersection(['p'], true);
      });
      layout.layOut();
      expect(pane.scrollTop).toBe(450 + 100 + 300);
      reportResize([getByTestId('column'), layout.row('p')]);

      expect(layout.topOf('visible')).toBe(before);
    });

    it('counts a row swapped in once when the restore falls back to the height change', () => {
      // The restore's anchor ('visible') is re-keyed in the commit, so it
      // falls back to the scrollHeight delta; the observer holds by 'a',
      // which has no .chat-message for the restore to pick.
      const rows = [
        { id: 'p', contentHeight: 400, mounted: false },
        { id: 'a', contentHeight: 300, mounted: true, plain: true },
        { id: 'visible', contentHeight: 300, mounted: true },
        { id: 'tail', contentHeight: 1000, mounted: true },
      ];
      const { layout, reportResize, commitRows, deliverIntersection, pane, session, getByTestId } = setup(rows, {
        scrollTop: 150,
        withSession: true,
      });
      const before = layout.topOf('a');

      act(() => {
        session().loadEarlierMessages();
        commitRows([rows[0], rows[1], { id: 'visible-regrouped', contentHeight: 300, mounted: true }, rows[3]]);
        deliverIntersection(['p'], true);
      });
      layout.layOut();
      expect(pane.scrollTop).toBe(150 + 300);
      reportResize([getByTestId('column'), layout.row('p')]);

      expect(layout.topOf('a')).toBe(before);
    });
  });

  describe('writes by useChatSessionState that land where the view already is', () => {
    // Such a write is not noted: the layout may already hold a change the
    // ResizeObserver has not reported, and retaking the anchor there would
    // make it the new baseline and leave it uncorrected.
    const atTheBottom = () => setup([
      { id: 'above', contentHeight: 300, mounted: true },
      { id: 'a', contentHeight: 300, mounted: true },
      { id: 'b', contentHeight: 300, mounted: true },
      { id: 'c', contentHeight: 300, mounted: true },
    ], { scrollTop: 600, clamp: true, withSession: true });

    it('still corrects the next change after a scroll to the bottom that was already there', () => {
      // The composer's deferred scroll to the bottom, 100ms after a send.
      const { layout, reportResize, contentHeights, session } = atTheBottom();
      const before = layout.topOf('b');

      act(() => session().scrollToBottom());
      contentHeights.set('above', 500);
      reportResize([layout.row('above')]);

      expect(layout.topOf('b')).toBe(before);
    });

    it('still corrects the next change after a restore that moved nothing', () => {
      const { layout, reportResize, contentHeights, session } = atTheBottom();
      const before = layout.topOf('b');

      // A widened window whose rows are already there lays nothing out above.
      act(() => session().loadEarlierMessages());
      contentHeights.set('above', 500);
      reportResize([layout.row('above')]);

      expect(layout.topOf('b')).toBe(before);
    });

    it('still corrects a change laid out but not yet reported when a restore moved nothing', () => {
      const { layout, reportResize, contentHeights, session } = atTheBottom();
      const before = layout.topOf('b');

      // An image above the view has settled, and the restore captures and
      // measures the layout that already holds it, so it adds 0.
      contentHeights.set('above', 500);
      act(() => session().loadEarlierMessages());
      reportResize([layout.row('above')]);

      expect(layout.topOf('b')).toBe(before);
    });

    it('still corrects the next change after returning to the tab at the bottom', () => {
      const { layout, reportResize, contentHeights, setActive } = atTheBottom();
      const before = layout.topOf('b');

      setActive(false);
      setActive(true);
      contentHeights.set('above', 500);
      reportResize([layout.row('above')]);

      expect(layout.topOf('b')).toBe(before);
    });
  });

  it('leaves scrolling to the browser where it has scroll anchoring', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const { layout, bringNear, reportResize } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'visible', contentHeight: 200, mounted: true },
    ], { scrollTop: 150 });
    const writesBefore = layout.scrollTopWrites();

    bringNear('old');
    reportResize([layout.row('old'), layout.row('visible')]);

    expect(layout.scrollTopWrites()).toBe(writesBefore);
  });

  it('keeps a search highlight added to a placeholder through its mount', () => {
    // The stylesheet holds the flash back on a placeholder; it plays once the
    // marker goes, so the class must outlive the swap.
    const { layout, bringNear } = setup([
      { id: 'hit', contentHeight: 420, mounted: false },
      { id: 'visible', contentHeight: 200, mounted: true },
    ]);
    layout.row('hit').classList.add('search-highlight-flash');

    bringNear('hit');

    expect(layout.row('hit').hasAttribute('data-lazy-placeholder')).toBe(false);
    expect(layout.row('hit').classList.contains('search-highlight-flash')).toBe(true);
  });

  it('keeps placeholders out of the browser\'s anchor selection', () => {
    const { layout, bringNear } = setup([
      { id: 'old', contentHeight: 420, mounted: false },
      { id: 'visible', contentHeight: 200, mounted: true },
    ]);

    expect(layout.row('old').hasAttribute('data-lazy-placeholder')).toBe(true);
    expect(layout.row('visible').hasAttribute('data-lazy-placeholder')).toBe(false);
    bringNear('old');
    expect(layout.row('old').hasAttribute('data-lazy-placeholder')).toBe(false);
  });
});

describe('transcript stylesheet', () => {
  const stylesheet = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Every innermost rule, as its selector list and its declarations.
  const rules = Array.from(stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .map((match) => ({ selector: match[1].trim(), declarations: match[2] }));
  const blocksFor = (selector: string) => rules
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.declarations);

  it('gives placeholders no width where the browser anchors, so its anchoring skips them', () => {
    // Without scroll anchoring (Safari before 27) useLazyRowObserver skips
    // placeholders itself, so there they keep their full width.
    const blocks = blocksFor('.chat-messages-pane [data-lazy-placeholder]');
    const scoped = stylesheet.match(
      /@supports\s*\(\s*overflow-anchor:\s*auto\s*\)\s*\{\s*\.chat-messages-pane \[data-lazy-placeholder\]\s*\{([^}]*)\}\s*\}/,
    );

    expect(blocks).toHaveLength(1);
    expect(scoped?.[1]).toBe(blocks[0]);
    expect(blocks[0]).toMatch(/(^|[\s;])width:\s*0(px)?\s*;/);
  });

  it('holds the search highlight back while its row is a placeholder', () => {
    // The jump lands on the row's wrapper, which may still be a placeholder:
    // the flash starts when the wrapper loses the marker as the row mounts.
    const blocks = blocksFor('.search-highlight-flash[data-lazy-placeholder]');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(/(^|[\s;])animation:\s*none\s*;/);
  });

  it('plays the search highlight for its full length under reduced motion', () => {
    // Reduced motion cuts every animation to 0.01ms, which would leave the
    // highlight on screen for no time at all; it only changes colours, so it
    // keeps the length of the flash itself, read from the one property both
    // rules use. The class still comes off on its animationend.
    const flashRules = blocksFor('.search-highlight-flash');
    const flashDuration = flashRules
      .map((declarations) => declarations.match(/--search-flash-duration:\s*([\d.]+m?s)\s*;/)?.[1])
      .find(Boolean);
    const reducedMotion = stylesheet.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/,
    )?.[1] ?? '';
    const reducedRules = Array.from(reducedMotion.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .map((match) => ({ selector: match[1].trim(), declarations: match[2] }));
    const flashRule = reducedRules.find((rule) => rule.selector === '.search-highlight-flash');

    expect(flashDuration).toBe('4s');
    expect(flashRules.some((declarations) => /animation:\s*search-flash\s+var\(--search-flash-duration\)\s/.test(declarations))).toBe(true);
    expect(reducedRules.some((rule) => /animation-duration:\s*0\.01ms\s*!important/.test(rule.declarations))).toBe(true);
    expect(flashRule?.declarations).toMatch(/(^|[\s;])animation-duration:\s*var\(--search-flash-duration\)\s*!important\s*;/);
  });

  it('keeps content-visibility off transcript rows', () => {
    // Any rule whose selector reaches a .chat-message, not only the bare one.
    const rowRules = rules.filter((rule) => /\.chat-message(?![\w-])/.test(rule.selector));

    expect(rowRules.length).toBeGreaterThan(0);
    for (const rule of rowRules) expect(rule.declarations, rule.selector).not.toMatch(/content-visibility/);
  });
});
