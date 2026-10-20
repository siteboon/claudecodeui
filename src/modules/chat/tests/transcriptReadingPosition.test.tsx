import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, useRef } from 'react';
import { act, render } from '@testing-library/react';

import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

/**
 * Scrolling up through a long transcript must not move the message being read
 * (#1574). Rows above the viewport change height after they first render: a
 * lazy row swaps its 100px estimate for its content. Browsers with CSS scroll
 * anchoring absorb that; Safari before 27 has none, so the transcript does it
 * there. And a page of older history must arrive with the rows next to the
 * reader already mounted, because the scroll restore that keeps the reader in
 * place runs in that commit. jsdom has no layout, so these tests model the
 * geometry a browser would report and drive the observers by hand.
 */

/** An IntersectionObserver that never reports: rows keep their initial state. */
class SilentIntersectionObserver {
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

/** Delivers one frame's resize reports; nothing happens when no observer was created. */
function fireResize(targets: Element[]): void {
  const observer = StubResizeObserver.instances[0];
  if (!observer) return;
  act(() => {
    observer.callback(
      targets.map((target) => ({ target }) as ResizeObserverEntry),
      observer as unknown as ResizeObserver,
    );
  });
}

function installObservers({ nativeScrollAnchoring }: { nativeScrollAnchoring: boolean }): void {
  vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.stubGlobal('CSS', {
    supports: (property: string, value?: string) => (
      nativeScrollAnchoring && property === 'overflow-anchor' && value === 'auto'
    ),
  });
}

const ROW_TIMESTAMPS = ['row-a', 'row-b', 'row-c', 'row-d'];
const VIEWPORT_HEIGHT = 600;

/**
 * Lays the rows out top to bottom in a 600px scroll container whose top edge
 * is at y=0, from heights that a test can change between frames. Every
 * `getBoundingClientRect` the code under test takes reads this model, and
 * scrollTop stays within the scrollable range the way a browser keeps it: a
 * write past the end lands at the end, and a layout that shrinks the content
 * under a scroller at its end pulls scrollTop in with it.
 */
function modelLayout(initialHeights: Record<string, number>, initialScrollTop: number) {
  const heights = { ...initialHeights };
  const contentHeight = () => ROW_TIMESTAMPS.reduce((sum, timestamp) => sum + heights[timestamp], 0);
  const clamp = (next: number) => Math.min(Math.max(next, 0), Math.max(contentHeight() - VIEWPORT_HEIGHT, 0));
  if (clamp(initialScrollTop) !== initialScrollTop) {
    throw new Error(`scrollTop ${initialScrollTop} is outside the modelled content`);
  }
  let scrollTop = initialScrollTop;
  let hidden = false;
  const scrollWrites: number[] = [];

  const scroller = () => document.querySelector<HTMLElement>('[data-testid="scroller"]');
  const rowTop = (timestamp: string) => {
    let top = -scrollTop;
    for (const candidate of ROW_TIMESTAMPS) {
      if (candidate === timestamp) return top;
      top += heights[candidate];
    }
    return top;
  };

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (hidden) return { top: 0, bottom: 0, height: 0, width: 0 } as DOMRect;
    if (this === scroller()) {
      return { top: 0, bottom: VIEWPORT_HEIGHT, height: VIEWPORT_HEIGHT, width: 400 } as DOMRect;
    }
    const timestamp = this.getAttribute('data-message-timestamp');
    if (!timestamp || !(timestamp in heights)) return { top: 0, bottom: 0, height: 0, width: 0 } as DOMRect;
    const top = rowTop(timestamp);
    return { top, bottom: top + heights[timestamp], height: heights[timestamp], width: 400 } as DOMRect;
  });

  return {
    scrollWrites,
    setHidden: (next: boolean) => { hidden = next; },
    /** Lays rows out at new heights, as the frame's layout does before its resize reports. */
    resize: (nextHeights: Record<string, number>) => {
      Object.assign(heights, nextHeights);
      scrollTop = clamp(scrollTop);
    },
    /** Installs the scroll geometry accessors once the scroller exists. */
    attach: () => {
      const element = scroller()!;
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (next: number) => {
          scrollTop = clamp(next);
          scrollWrites.push(next);
        },
      });
      Object.defineProperty(element, 'scrollHeight', {
        configurable: true,
        get: () => Math.max(contentHeight(), VIEWPORT_HEIGHT),
      });
      Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => VIEWPORT_HEIGHT });
    },
    get scrollTop() { return scrollTop; },
    get distanceFromBottom() { return Math.max(contentHeight() - VIEWPORT_HEIGHT, 0) - scrollTop; },
    offsetOf: (timestamp: string) => rowTop(timestamp),
    row: (timestamp: string) => document.querySelector(`[data-message-timestamp="${timestamp}"]`) as Element,
  };
}

function Transcript() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    <div ref={scrollContainerRef} data-testid="scroller">
      {ROW_TIMESTAMPS.map((timestamp) => (
        <LazyMessageRow key={timestamp} lazyRows={lazyRows} timestamp={timestamp} initiallyNearViewport>
          <p>{timestamp}</p>
        </LazyMessageRow>
      ))}
    </div>
  );
}

/**
 * By default 800px of rows scrolled 200px, which is the bottom: rows a and b
 * above the viewport, c at its top edge, d inside it.
 */
function renderTranscript({ scrollTop = 200, heights = {} }: {
  scrollTop?: number;
  heights?: Record<string, number>;
} = {}) {
  const layout = modelLayout(
    { 'row-a': 100, 'row-b': 100, 'row-c': 300, 'row-d': 300, ...heights },
    scrollTop,
  );
  render(<Transcript />);
  layout.attach();
  return layout;
}

/** Row d 900px tall, so the default 200px scroll position is 600px above the bottom. */
const TALL_LAST_ROW = { 'row-d': 900 };

afterEach(() => {
  StubResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('transcript reading position without native scroll anchoring', () => {
  it('holds the row being read still when a row above the viewport grows', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript();
    expect(layout.offsetOf('row-c')).toBe(0);

    // A lazy row above the viewport mounts: its 100px estimate becomes 400px.
    layout.resize({ 'row-a': 400 });
    fireResize([layout.row('row-a')]);

    expect(layout.scrollTop).toBe(500);
    expect(layout.offsetOf('row-c')).toBe(0);
    // The reader was at the bottom and still is.
    expect(layout.distanceFromBottom).toBe(0);
  });

  it('follows a row above the viewport that shrinks', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript({ heights: TALL_LAST_ROW });

    // A lazy row whose 100px estimate was taller than its content.
    layout.resize({ 'row-b': 40 });
    fireResize([layout.row('row-b')]);

    expect(layout.offsetOf('row-c')).toBe(0);
    expect(layout.scrollTop).toBe(140);
  });

  it('stays at the bottom when a row far above it shrinks', () => {
    installObservers({ nativeScrollAnchoring: false });
    // 1300px of rows scrolled to the end; row a ends 300px above the viewport.
    const layout = renderTranscript({ scrollTop: 700, heights: { 'row-a': 400, 'row-b': 300 } });

    // The content shrinks by 60px, and layout clamps scrollTop to the new end,
    // which already leaves the rows in view where they were. Scrolling up by
    // the shrink as well pulled the reader 60px off the bottom, where they
    // stopped following new messages.
    layout.resize({ 'row-a': 340 });
    fireResize([layout.row('row-a')]);

    expect(layout.distanceFromBottom).toBe(0);
    expect(layout.offsetOf('row-c')).toBe(0);
    expect(layout.scrollWrites).toEqual([]);
  });

  it('does not scroll for a change of less than half a pixel', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript({ heights: TALL_LAST_ROW });

    // Rounding between the committed height and the reported one: no visible
    // move, and a scroll write can cut short an iOS momentum scroll.
    layout.resize({ 'row-a': 100.3 });
    fireResize([layout.row('row-a')]);

    expect(layout.scrollWrites).toEqual([]);
  });

  it('measures from the committed height even when the first resize report is already the new one', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript();

    // The row settled its real height in the frame after the commit (an image,
    // a highlighted code block), before the observer ever reported it: the
    // report is the first one it sends.
    layout.resize({ 'row-a': 250 });
    fireResize(ROW_TIMESTAMPS.map(layout.row));

    expect(layout.offsetOf('row-c')).toBe(0);
  });

  it('applies the rows of one frame as a single scroll adjustment', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript();

    layout.resize({ 'row-a': 180, 'row-b': 260 });
    // Reported out of document order.
    fireResize([layout.row('row-b'), layout.row('row-a')]);

    expect(layout.offsetOf('row-c')).toBe(0);
    expect(layout.scrollWrites).toEqual([440]);
  });

  it('leaves the scroll position alone when the growing row is inside the viewport', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript();

    layout.resize({ 'row-c': 900, 'row-d': 500 });
    fireResize([layout.row('row-c'), layout.row('row-d')]);

    expect(layout.scrollWrites).toEqual([]);
  });

  it('leaves a row that reaches into the viewport alone, like a reply streaming in above the fold', () => {
    installObservers({ nativeScrollAnchoring: false });
    // Row c starts 50px above the viewport and fills it.
    const layout = renderTranscript({ scrollTop: 250, heights: TALL_LAST_ROW });

    layout.resize({ 'row-c': 700 });
    fireResize([layout.row('row-c')]);

    // Its visible part stays put and it grows downward, as scroll anchoring
    // would leave it; compensating would scroll the text being read away.
    expect(layout.scrollWrites).toEqual([]);
    expect(layout.offsetOf('row-c')).toBe(-50);
  });

  it('ignores the zero-size reports of a hidden Chat tab', () => {
    installObservers({ nativeScrollAnchoring: false });
    const layout = renderTranscript();

    layout.setHidden(true);
    fireResize(ROW_TIMESTAMPS.map(layout.row));
    layout.setHidden(false);
    fireResize(ROW_TIMESTAMPS.map(layout.row));

    expect(layout.scrollWrites).toEqual([]);
    expect(layout.offsetOf('row-c')).toBe(0);
  });

  it('leaves the reading position to the browser where it has scroll anchoring', () => {
    installObservers({ nativeScrollAnchoring: true });
    renderTranscript();

    // Compensating as well would move the transcript twice.
    expect(StubResizeObserver.instances).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Prepending a page of history                                      */
/* ------------------------------------------------------------------ */

const message = (index: number): ChatMessage => ({
  type: index % 2 === 0 ? 'user' : 'assistant',
  content: `message ${index}`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
});

const HISTORY = Array.from({ length: 150 }, (_, index) => message(index));

/**
 * 200 messages where 135-144 are one run of Read calls, which the transcript
 * shows as a single tool group row.
 */
const HISTORY_WITH_TOOL_RUN = Array.from({ length: 200 }, (_, index): ChatMessage => (
  index >= 135 && index < 145
    ? {
      type: 'assistant',
      content: '',
      isToolUse: true,
      toolName: 'Read',
      toolId: `tool-${index}`,
      toolInput: JSON.stringify({ file_path: `/repo/file-${index}.ts` }),
      timestamp: message(index).timestamp,
    }
    : message(index)
));

const noop = () => undefined;
const stablePaneProps = {
  scrollContainerRef: createRef<HTMLDivElement>(),
  textareaRef: createRef<HTMLTextAreaElement>(),
  selectedSession: { id: 'session-1' },
  selectedProject: { projectId: 'project-1', name: 'repo', path: '/repo' },
  providerModels: {},
  providerModelCatalog: {},
  providerModelActions: {},
  createDiff: () => [],
  onGrantToolPermission: () => ({ success: true }),
  onWheel: noop,
  onTouchMove: noop,
  isLoadingSessionMessages: false,
  currentSessionId: 'session-1',
  provider: 'claude',
  setProvider: noop,
  setProviderModel: noop,
  providerModelsLoading: false,
  tasksEnabled: false,
  isTaskMasterInstalled: false,
  onShowAllTasks: null,
  setInput: noop,
  isLoadingMoreMessages: false,
  hasMoreMessages: true,
  totalMessages: HISTORY.length,
  loadEarlierMessages: noop,
  revealMessage: noop,
  sendMessage: noop,
  loadAllMessages: noop,
  allMessagesLoaded: false,
  isLoadingAllMessages: false,
  loadAllJustFinished: false,
  showLoadAllOverlay: false,
  showRawParameters: false,
  showThinking: true,
};

/** The pane showing the newest `count` messages, as each history page widens the window. */
function paneShowingLast(count: number, history = HISTORY) {
  const visible = history.slice(-count);
  const props = {
    ...stablePaneProps,
    chatMessages: visible,
    visibleMessages: visible,
    visibleMessageCount: count,
    sessionMessagesCount: visible.length,
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (
    <UiPreferencesProvider>
      <ChatMessagesPane {...(props as any)} />
    </UiPreferencesProvider>
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const isMounted = (container: HTMLElement, item: ChatMessage) => {
  const row = container.querySelector(`[data-message-timestamp="${String(item.timestamp)}"]`) as HTMLElement;
  return row.querySelector('.chat-message') !== null;
};

/** Whether a row (a message or a tool group) renders its content rather than an empty placeholder. */
const rendersContent = (container: HTMLElement, item: ChatMessage) => {
  const row = container.querySelector(`[data-message-timestamp="${String(item.timestamp)}"]`);
  return row !== null && row.childElementCount > 0;
};

describe('prepending a page of history', () => {
  it('mounts the rows of each prepended page in the commit that restores the scroll position', () => {
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);

    const view = render(paneShowingLast(20));
    view.rerender(paneShowingLast(40));
    view.rerender(paneShowingLast(60));

    // The third page's rows sit directly above where the reader is. Left as
    // 100px placeholders, they mounted a frame after the restore and pushed
    // the transcript down by several messages in every browser.
    const thirdPage = HISTORY.slice(-60, -40);
    expect(thirdPage.filter((item) => !isMounted(view.container, item))).toEqual([]);
  });

  it('keeps rows far above the reading position as placeholders when a large range is prepended', () => {
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);

    const view = render(paneShowingLast(20));
    // "Load all": everything older arrives in one commit.
    view.rerender(paneShowingLast(HISTORY.length));

    const prepended = HISTORY.slice(0, -20);
    const mounted = prepended.filter((item) => isMounted(view.container, item));
    // Only the rows next to the reading position, never the whole history.
    expect(mounted).toEqual(prepended.slice(prepended.length - mounted.length));
    expect(mounted.length).toBeGreaterThanOrEqual(20);
    expect(mounted.length).toBeLessThanOrEqual(40);
  });

  it('mounts the prepended rows when the page boundary falls inside a tool run', () => {
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);

    // The window starts at message 140, so its first row groups Reads 140-144.
    const view = render(paneShowingLast(60, HISTORY_WITH_TOOL_RUN));
    // The next page ends with Reads 135-139. They join that group, which then
    // starts at 135 and takes a new key: the old first row's key is gone.
    view.rerender(paneShowingLast(80, HISTORY_WITH_TOOL_RUN));

    const pageRows = [...HISTORY_WITH_TOOL_RUN.slice(120, 135), HISTORY_WITH_TOOL_RUN[135]];
    expect(pageRows.filter((item) => !rendersContent(view.container, item))).toEqual([]);
  });
});
