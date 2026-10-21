import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The transcript's scroll position is written from five places coordinated by
 * refs and timers rather than by one owner. These are the two cases where that
 * coordination was observably wrong; both are timing bugs, so they are driven
 * on fake timers rather than by clicking.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const buildMessage = (index: number, timestamp: string): NormalizedMessage => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: SESSION_A,
  content: `message ${index}`,
  timestamp,
} as NormalizedMessage);

/**
 * jsdom has no layout, so scrollHeight/clientHeight are always 0 and assigning
 * scrollTop emits nothing. These are the exact reads the scroll code makes,
 * with scrollTop kept within the scrollable range as a browser keeps it, and
 * no geometry at all while hidden (a display:none Chat tab).
 */
function createContainer(scrollHeight: number, initialClientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let contentHeight = scrollHeight;
  let clientHeight = initialClientHeight;
  let hidden = false;
  const maxScrollTop = () => Math.max(contentHeight - clientHeight, 0);
  let scrollTop = maxScrollTop();
  const clamp = (next: number) => Math.min(Math.max(next, 0), maxScrollTop());

  Object.defineProperty(element, 'scrollHeight', { get: () => (hidden ? 0 : contentHeight) });
  Object.defineProperty(element, 'clientHeight', { get: () => (hidden ? 0 : clientHeight) });
  Object.defineProperty(element, 'scrollTop', {
    get: () => (hidden ? 0 : scrollTop),
    set: (next: number) => {
      writes.push(next);
      if (!hidden) scrollTop = clamp(next);
    },
  });

  return {
    element: element as HTMLDivElement,
    writes,
    get scrollHeight() { return contentHeight; },
    get distanceFromBottom() { return maxScrollTop() - scrollTop; },
    /** Content committed below what is on screen: nothing scrolls, so no scroll event fires. */
    grow: (px: number) => { contentHeight += px; },
    setHidden: (next: boolean) => { hidden = next; },
    /** The pane's own height changes (a rotated phone, a taller composer); scrollTop stays in range. */
    setClientHeight: (px: number) => {
      clientHeight = px;
      scrollTop = clamp(scrollTop);
    },
    /** Layout itself moves scrollTop, as scroll anchoring does: not a write by the app. */
    layoutScrollTo: (top: number) => { scrollTop = clamp(top); },
  };
}

function createStore(messagesBySession: Map<string, NormalizedMessage[]>) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: false,
    offset: messagesBySession.get(sessionId)?.length ?? 0,
  });

  return {
    fetchFromServer: vi.fn(async (sessionId: string) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async (sessionId: string) => ({
      slot: slotFor(sessionId),
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn((sessionId: string) => messagesBySession.get(sessionId) ?? []),
    getSessionSlot: vi.fn((sessionId: string) => slotFor(sessionId)),
  };
}

async function renderChatSessionState(options: {
  session: ProjectSession;
  store: ReturnType<typeof createStore>;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  const initialProps: { session: ProjectSession; isActive?: boolean } = { session: options.session };
  return renderHook(
    ({ session, isActive = true }: { session: ProjectSession; isActive?: boolean }) =>
      useChatSessionState({
        isActive,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(),
        resetStreamingState: vi.fn(),
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: options.store as never,
      }),
    { initialProps },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // The initial-scroll effect is a separate writer that re-scrolls to the
  // bottom every animation frame until the height settles. It would satisfy an
  // assertion meant for the deferred timer, so it is silenced here — these
  // tests are about which writer wins, and it is not one of the two.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('deferred scroll-to-bottom', () => {
  it('does not yank the view back down when the user scrolls up inside the delay', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // A new row lands while the user is at the bottom: a scroll is armed for +50ms.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });

    // ...and the user drags upward before it fires.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    assert.deepEqual(
      container.writes,
      [],
      `a scroll armed before the user scrolled up must not fire afterwards; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('still sticks to the bottom when the user has not scrolled away', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.writes).toContain(container.scrollHeight);
  });
});

/** An IntersectionObserver that never reports. */
class SilentIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** A ResizeObserver whose reports the test delivers by hand. */
class StubResizeObserver {
  static instances: StubResizeObserver[] = [];

  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('following new messages at the bottom', () => {
  afterEach(() => {
    StubResizeObserver.instances = [];
  });

  it('keeps following when more of a reply is committed before its scroll-to-bottom fires its scroll event', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // A reply starts while the reader is at the bottom: 50ms later the
    // transcript scrolls to the bottom.
    messages.set(SESSION_A, [...messages.get(SESSION_A)!, buildMessage(1, '2026-01-01T00:00:01.000Z')]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.distanceFromBottom).toBe(0);

    // More of the reply is committed before that scroll's event is dispatched,
    // so the event finds the bottom 200px further down. The reader did not move.
    container.grow(200);
    act(() => {
      void result.current.handleScroll();
    });
    expect(result.current.isUserScrolledUp).toBe(false);

    // The next message is still followed.
    container.writes.length = 0;
    messages.set(SESSION_A, [...messages.get(SESSION_A)!, buildMessage(2, '2026-01-01T00:00:02.000Z')]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.writes).toContain(container.scrollHeight);
  });

  it('follows again after "Scroll to bottom" even when more of a reply is committed before its scroll event', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    // The transcript opened at its bottom, and the reader had scrolled up
    // while a reply streams in.
    act(() => {
      void result.current.handleScroll();
    });
    container.element.scrollTop = 3000;
    act(() => {
      void result.current.handleScroll();
    });
    expect(result.current.isUserScrolledUp).toBe(true);

    // They press "Scroll to bottom", and the stream commits more before the
    // scroll's event is dispatched.
    act(() => {
      result.current.scrollToBottomAndReset();
    });
    container.grow(200);
    act(() => {
      void result.current.handleScroll();
    });

    expect(result.current.isUserScrolledUp).toBe(false);
  });

  it('keeps following when the transcript holds the reading position in a browser without scroll anchoring', async () => {
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.stubGlobal('CSS', { supports: () => false });
    const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
    const { useLazyRowObserver } = await import('@/modules/chat/hooks/useLazyRowObserver');

    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    // The session state and the pane's row observer, sharing the scroller as
    // ChatInterface and ChatMessagesPane do.
    const { result, rerender } = renderHook(
      ({ session }: { session: ProjectSession }) => {
        const state = useChatSessionState({
          isActive: true,
          selectedProject: project,
          selectedSession: session,
          ws: null,
          sendMessage: vi.fn(),
          resetStreamingState: vi.fn(),
          statusCheckSentAtRef: { current: new Map() },
          lastSeqRef: { current: new Map() },
          sessionStore: store as never,
        });
        return { state, lazyRows: useLazyRowObserver(state.scrollContainerRef) };
      },
      { initialProps: { session: { id: SESSION_A } as ProjectSession } },
    );

    const container = createContainer(5000, 500);
    const pane = container.element;
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500, width: 400 }) as DOMRect;
    (result.current.state.scrollContainerRef as { current: HTMLDivElement | null }).current = pane;

    // A mounted row 1000px down the content, far above the reader.
    let rowHeight = 300;
    const row = document.createElement('div');
    row.getBoundingClientRect = () => {
      const top = 1000 - pane.scrollTop;
      return { top, bottom: top + rowHeight, height: rowHeight, width: 400 } as DOMRect;
    };
    pane.appendChild(row);
    act(() => {
      result.current.lazyRows!.observe(row, () => undefined);
    });

    // An image in the last row loads: the bottom moves 293px down, no scroll
    // event fires, and the reader is still following the transcript.
    container.grow(293);
    // Then the row above grows by 216px and the transcript scrolls by as much
    // to keep the content in view still.
    rowHeight = 516;
    container.grow(216);
    act(() => {
      StubResizeObserver.instances[0].callback(
        [{ target: row } as unknown as ResizeObserverEntry],
        StubResizeObserver.instances[0] as unknown as ResizeObserver,
      );
    });
    expect(container.distanceFromBottom).toBe(293);

    // That scroll's event is the transcript's own, not the reader scrolling away.
    act(() => {
      void result.current.state.handleScroll();
    });
    expect(result.current.state.isUserScrolledUp).toBe(false);

    container.writes.length = 0;
    messages.set(SESSION_A, [...messages.get(SESSION_A)!, buildMessage(1, '2026-01-01T00:00:01.000Z')]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.writes).toContain(container.scrollHeight);
  });
});

describe('telling the reader\'s scrolls from the transcript\'s own', () => {
  /** A session at its bottom, scrolled there by the transcript itself when a message landed. */
  async function renderScrolledToBottomByTheApp() {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const hook = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
    const container = createContainer(5000, 500);
    (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    messages.set(SESSION_A, [...messages.get(SESSION_A)!, buildMessage(1, '2026-01-01T00:00:01.000Z')]);
    act(() => {
      hook.rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.distanceFromBottom).toBe(0);
    return {
      ...hook,
      container,
      scrollEvent: () => act(() => {
        void hook.result.current.handleScroll();
      }),
      nextMessage: () => {
        messages.set(SESSION_A, [...messages.get(SESSION_A)!, buildMessage(2, '2026-01-01T00:00:02.000Z')]);
        act(() => {
          hook.rerender({ session: { id: SESSION_A } as ProjectSession });
        });
        act(() => {
          vi.advanceTimersByTime(200);
        });
      },
    };
  }

  it('stops following once the reader scrolls up from where the transcript scrolled itself', async () => {
    const { result, container, scrollEvent, nextMessage } = await renderScrolledToBottomByTheApp();

    // Three wheel notches up.
    container.element.scrollTop -= 300;
    scrollEvent();
    expect(result.current.isUserScrolledUp).toBe(true);

    container.writes.length = 0;
    nextMessage();
    expect(container.writes).toEqual([]);
  });

  it('leaves a reader who scrolls back down to where the transcript last scrolled itself scrolled up', async () => {
    const { result, container, scrollEvent, nextMessage } = await renderScrolledToBottomByTheApp();

    // The reader wheels up three notches while a reply grows 800px below, no
    // scroll event, then wheels back down three: exactly where the transcript
    // last scrolled itself to the bottom, which is now 800px above it.
    container.element.scrollTop -= 300;
    scrollEvent();
    container.grow(800);
    container.element.scrollTop += 300;
    scrollEvent();
    expect(container.distanceFromBottom).toBe(800);
    expect(result.current.isUserScrolledUp).toBe(true);

    // So the next message leaves them where they are.
    container.writes.length = 0;
    nextMessage();
    expect(container.writes).toEqual([]);
  });
});

/**
 * A session whose first message lands while the pane is on screen, so the
 * transcript scrolls itself to the bottom and follows new messages from then
 * on. ResizeObserver reports, which the browser delivers right after a
 * layout, are delivered by hand.
 */
async function renderFollowingTranscript() {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, []]]);
  const store = createStore(messages);
  const hook = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
  const container = createContainer(5000, 500);
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

  let messageCount = 0;
  const addMessage = () => {
    const message = buildMessage(messageCount, new Date(Date.UTC(2026, 0, 1, 0, 0, messageCount)).toISOString());
    messageCount += 1;
    messages.set(SESSION_A, [...messages.get(SESSION_A)!, message]);
    act(() => {
      hook.rerender({ session: { id: SESSION_A } as ProjectSession });
    });
  };
  const scrollEvent = () => act(() => {
    void hook.result.current.handleScroll();
  });

  addMessage();
  act(() => {
    vi.advanceTimersByTime(60);
  });
  scrollEvent();
  expect(container.distanceFromBottom).toBe(0);
  expect(hook.result.current.isUserScrolledUp).toBe(false);

  return {
    ...hook,
    container,
    addMessage,
    scrollEvent,
    /** The browser's report that the pane changed size. */
    reportPaneResize: () => act(() => {
      for (const observer of StubResizeObserver.instances) {
        observer.callback(
          [{ target: container.element } as unknown as ResizeObserverEntry],
          observer as unknown as ResizeObserver,
        );
      }
    }),
  };
}

describe('following new messages through layout changes', () => {
  afterEach(() => {
    StubResizeObserver.instances = [];
  });

  it('keeps a reader who follows the transcript at the bottom when the pane is resized', async () => {
    const { result, container, addMessage, scrollEvent } = await renderFollowingTranscript();

    // The phone turns back to portrait: the pane gets taller and scroll
    // anchoring, holding the rows in view while every row re-wraps, leaves
    // the bottom 900px below. Its scroll event comes before the resize report.
    container.setClientHeight(800);
    container.layoutScrollTo(container.element.scrollTop - 900);
    scrollEvent();
    expect(container.distanceFromBottom).toBe(0);
    expect(result.current.isUserScrolledUp).toBe(false);

    container.writes.length = 0;
    addMessage();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.writes).toContain(container.scrollHeight);
  });

  it('keeps following when the resize is reported before its scroll event', async () => {
    const { result, container, scrollEvent, reportPaneResize } = await renderFollowingTranscript();

    container.setClientHeight(800);
    container.layoutScrollTo(container.element.scrollTop - 900);
    reportPaneResize();
    expect(container.distanceFromBottom).toBe(0);

    scrollEvent();
    expect(result.current.isUserScrolledUp).toBe(false);
  });

  it('keeps following when scroll anchoring moves the transcript down after it scrolled itself to the bottom', async () => {
    const { result, container, addMessage, scrollEvent } = await renderFollowingTranscript();

    // A message lands, and in the same layout a row above the reader grows by
    // 52px: scroll anchoring moves scrollTop by those 52px, and the message's
    // own 83px are below. That move's scroll event arrives before the
    // message's deferred scroll to the bottom fires.
    addMessage();
    container.grow(52 + 83);
    container.layoutScrollTo(container.element.scrollTop + 52);
    scrollEvent();
    expect(container.distanceFromBottom).toBe(83);
    expect(result.current.isUserScrolledUp).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(container.distanceFromBottom).toBe(0);
  });

  it('leaves a reader who scrolled up where they are when the pane is resized', async () => {
    const { result, container, scrollEvent, reportPaneResize } = await renderFollowingTranscript();
    container.element.scrollTop = 3000;
    scrollEvent();
    expect(result.current.isUserScrolledUp).toBe(true);
    container.writes.length = 0;

    container.setClientHeight(800);
    container.layoutScrollTo(2500);
    reportPaneResize();
    scrollEvent();

    expect(container.writes).toEqual([]);
    expect(result.current.isUserScrolledUp).toBe(true);
  });

  it('leaves a reader who scrolls up in the frame the pane is resized where they are', async () => {
    const { result, container } = await renderFollowingTranscript();

    // One frame: the reader's scroll event is dispatched, then the pane's
    // layout changes and is reported, before React has re-rendered.
    act(() => {
      container.element.scrollTop -= 300;
      container.writes.length = 0;
      void result.current.handleScroll();
      container.setClientHeight(400);
      for (const observer of StubResizeObserver.instances) {
        observer.callback(
          [{ target: container.element } as unknown as ResizeObserverEntry],
          observer as unknown as ResizeObserver,
        );
      }
    });

    expect(container.writes).toEqual([]);
    expect(result.current.isUserScrolledUp).toBe(true);
  });

  it('takes the reader\'s next scroll after a resize that fired no scroll event for the reader\'s', async () => {
    const { result, addMessage, container, scrollEvent, reportPaneResize } = await renderFollowingTranscript();

    // The composer grows by a line: the pane gets 100px shorter and scrollTop
    // stays, so no scroll event fires; the reader is kept at the bottom.
    container.setClientHeight(400);
    reportPaneResize();
    expect(container.distanceFromBottom).toBe(0);

    // Then the reader scrolls up.
    container.element.scrollTop -= 300;
    scrollEvent();
    expect(result.current.isUserScrolledUp).toBe(true);

    container.writes.length = 0;
    addMessage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.writes).toEqual([]);
  });
});

describe('search jump ownership', () => {
  it('does not follow the user into the next session', { timeout: 20_000 }, async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:05.000Z')]],
    ]);
    const store = createStore(messages);
    const searchSession = {
      id: SESSION_A,
      __searchTargetSnippet: 'message 0',
      __searchTargetTimestamp: '2026-01-01T00:00:00.000Z',
    } as unknown as ProjectSession;

    const { result, rerender } = await renderChatSessionState({ session: searchSession, store });

    const container = createContainer(5000, 500);
    // The row session B renders. The jump requested against session A resolves
    // by timestamp, and on its last retry it accepts the nearest row it can
    // find — which, after the switch, is this one.
    const sessionBRow = document.createElement('div');
    sessionBRow.setAttribute('data-message-timestamp', '2026-01-01T00:00:05.000Z');
    container.element.appendChild(sessionBRow);

    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // Let the jump arm and start retrying.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The user gives up waiting and opens a different session.
    await act(async () => {
      rerender({ session: { id: SESSION_B } as ProjectSession });
    });

    // Let the whole retry budget elapse (20 retries, 150ms apart).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3400);
    });

    assert.equal(
      scrollIntoView.mock.calls.length,
      0,
      'a jump requested in the previous session must not scroll the new one',
    );
    assert.equal(
      container.element.querySelectorAll('.search-highlight-flash').length,
      0,
      'and must not flash the search highlight on one of its rows',
    );
  });
});

/**
 * A transcript showing its newest 20 messages with 20 older ones on the
 * server. Its first rendered row is laid out 100px down the content until the
 * older messages render above it and push it 2000px further down. Older
 * messages (a page, or all of them) arrive only when the test delivers them,
 * like a slow network.
 */
async function renderWithOlderHistory() {
  const olderPage = Array.from({ length: 20 }, (_, index) => (
    buildMessage(index, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString())
  ));
  const latestPage = Array.from({ length: 20 }, (_, index) => (
    buildMessage(20 + index, new Date(Date.UTC(2026, 0, 1, 0, 1, index)).toISOString())
  ));
  const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, latestPage]]);
  const store = createStore(messages);
  const partialSlot = { fetchedAt: 1, status: 'idle' as const, total: 40, hasMore: true, offset: 20 };
  const completeSlot = { fetchedAt: 1, status: 'idle' as const, total: 40, hasMore: false, offset: 40 };
  store.getSessionSlot.mockImplementation(() => partialSlot);

  let deliverPending: () => void = () => undefined;
  const arriveLater = <T,>(value: T) => new Promise<T>((resolve) => {
    deliverPending = () => {
      messages.set(SESSION_A, [...olderPage, ...latestPage]);
      resolve(value);
    };
  });
  store.fetchMore.mockImplementation(() => arriveLater({ slot: completeSlot, prependedCount: 20 }) as never);
  store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
    options?.limit === null ? arriveLater(completeSlot) : Promise.resolve(partialSlot)
  )) as never);

  // React renders the older messages when the hook reads the merged list, so
  // the model moves the row then.
  let rowContentTop = 100;
  const getMessages = store.getMessages.getMockImplementation()!;
  store.getMessages.mockImplementation((sessionId: string) => {
    const list = getMessages(sessionId);
    if (list.length === 40) rowContentTop = 2100;
    return list;
  });

  const hook = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

  const container = createContainer(6000, 500);
  const pane = container.element;
  let hidden = false;
  const paneBox = { top: 0, bottom: 500, height: 500, width: 400 } as DOMRect;
  const noBox = { top: 0, bottom: 0, height: 0, width: 0 } as DOMRect;
  pane.getBoundingClientRect = () => (hidden ? noBox : paneBox);
  pane.getClientRects = () => (hidden ? [] : [paneBox]) as unknown as DOMRectList;
  const row = document.createElement('div');
  row.className = 'chat-message';
  row.getBoundingClientRect = () => {
    if (hidden) return noBox;
    const top = rowContentTop - pane.scrollTop;
    return { top, bottom: top + 300, height: 300, width: 400 } as DOMRect;
  };
  pane.appendChild(row);
  document.body.appendChild(pane);
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = pane;

  return {
    ...hook,
    store,
    pane,
    rowOffset: () => row.getBoundingClientRect().top,
    deliver: () => act(async () => {
      deliverPending();
      await vi.advanceTimersByTimeAsync(0);
    }),
    /** Hides the pane as a display:none Chat tab does: no boxes, no scroll geometry. */
    setHidden: (next: boolean) => {
      hidden = next;
      container.setHidden(next);
    },
  };
}

describe('older-history restore', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the scrolling the reader did while the older page was loading', async () => {
    const { result, store, pane, rowOffset, deliver } = await renderWithOlderHistory();

    // Reaching the top asks for the older page...
    pane.scrollTop = 90;
    await act(async () => {
      void result.current.handleScroll();
      await vi.advanceTimersByTimeAsync(0);
    });
    assert.equal(store.fetchMore.mock.calls.length, 1, 'the older page must have been requested');

    // ...and the momentum carries the transcript another 60px while it loads.
    pane.scrollTop = 30;
    const offsetBeforePage = rowOffset();

    await deliver();

    assert.equal(
      rowOffset(),
      offsetBeforePage,
      'the row on screen when the page arrived must stay where it was, not jump back to where it was at the request',
    );
  });

  it('keeps the scrolling the reader did while "Load all" was loading', async () => {
    const { result, store, pane, rowOffset, deliver } = await renderWithOlderHistory();

    pane.scrollTop = 150;
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });
    await act(async () => {
      void result.current.loadAllMessages();
      await vi.advanceTimersByTimeAsync(0);
    });
    const requests = store.fetchFromServer.mock.calls as unknown as [string, { limit?: number | null }?][];
    assert.ok(
      requests.some(([, options]) => options?.limit === null),
      'the whole transcript must have been requested',
    );

    // The reader keeps scrolling up while it loads.
    pane.scrollTop = 110;
    const offsetBeforeHistory = rowOffset();

    await deliver();

    assert.equal(rowOffset(), offsetBeforeHistory);
  });

  it('restores the position from the request when the page lands while the Chat tab is hidden', async () => {
    const { result, rerender, pane, rowOffset, deliver, setHidden } = await renderWithOlderHistory();

    pane.scrollTop = 90;
    await act(async () => {
      void result.current.handleScroll();
      await vi.advanceTimersByTimeAsync(0);
    });
    const offsetAtRequest = rowOffset();

    // The reader switches to another tab; the page lands meanwhile. A hidden
    // pane has no layout to read the reading position from.
    setHidden(true);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: false });
    });
    await deliver();

    setHidden(false);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    assert.equal(rowOffset(), offsetAtRequest);
  });

  it('leaves a reader in older history scrolled up after the restore\'s own scroll event', async () => {
    const { result, pane, deliver } = await renderWithOlderHistory();

    // The session opened at its bottom; the reader scrolled up to the top.
    act(() => {
      void result.current.handleScroll();
    });
    pane.scrollTop = 90;
    await act(async () => {
      void result.current.handleScroll();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isUserScrolledUp).toBe(true);

    await deliver();
    expect(pane.scrollTop).toBeGreaterThan(1000);
    // The scroll event of the restore, which put the reader far above the bottom.
    act(() => {
      void result.current.handleScroll();
    });
    expect(result.current.isUserScrolledUp).toBe(true);
  });
});
