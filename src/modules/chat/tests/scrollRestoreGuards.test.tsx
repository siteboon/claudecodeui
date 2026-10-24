import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The scroll restore that keeps the view still when rows are put in front of
 * the first one, and the requests that arm it. A page or a full transcript
 * landing after the user switched sessions used to arm the old session's
 * restore and window on the new one; "Load earlier" widened the window with
 * no restore, so only browsers with native scroll anchoring held the view.
 */

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }) } },
}));

const project: Project = { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo', isStarred: false };
const sessionA: ProjectSession = { id: 'session-a', summary: 'A', lastActivity: '2026-01-01T00:00:00.000Z', messageCount: 1 } as ProjectSession;
const sessionB: ProjectSession = { id: 'session-b', summary: 'B', lastActivity: '2026-01-01T00:00:00.000Z', messageCount: 1 } as ProjectSession;
const slot = { fetchedAt: 1, status: 'idle' as const, total: 500, hasMore: true, offset: 100 };
// What the store's fetchFromServer reports for a request that loaded, and for
// one that failed (the slot then still holds what an earlier request loaded).
const fetched = (fields: Partial<typeof slot> = {}) => ({ slot: { ...slot, ...fields }, ok: true });
const fetchFailed = (fields: Partial<typeof slot> = {}) => ({ slot: { ...slot, ...fields, status: 'error' as const }, ok: false });
const store = {
  fetchFromServer: vi.fn(async () => fetched()),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(async () => ({ slot, deferred: false })),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn((): NormalizedMessage[] => []),
  getSessionSlot: vi.fn(() => slot),
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  store.fetchFromServer.mockImplementation(async () => fetched());
  store.getMessages.mockImplementation(() => []);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

type SessionStateProps = { selected: ProjectSession; active?: boolean; newSessionTrigger?: number };

const renderSessionState = async (session = sessionA, isActive = true) => {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const hook = renderHook<ReturnType<typeof useChatSessionState>, SessionStateProps>(({ selected, active, newSessionTrigger }) =>
    useChatSessionState({
      isActive: active ?? true,
      selectedProject: project,
      selectedSession: selected,
      ws: null,
      sendMessage: vi.fn(),
      newSessionTrigger,
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
    }), { initialProps: { selected: session, active: isActive } });
  await act(async () => {});
  return hook;
};

// Hands the hook the pane it scrolls, the way ChatMessagesPane binds its ref.
const attachPane = (
  hook: Awaited<ReturnType<typeof renderSessionState>>,
  container: HTMLDivElement,
) => {
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container;
};

// A transcript of `count` loaded messages for session A.
const transcript = (count: number): NormalizedMessage[] => Array.from({ length: count }, (_, index) => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: sessionA.id,
  content: `message number ${index} of the transcript`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
} as NormalizedMessage));

// A shown pane (600px tall) holding one message row whose top the test moves
// the way a commit laying rows out above it would. `writes` lists every
// scrollTop written to it.
const shownPane = (height = 600) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let scrollTop = 10;
  const writes: number[] = [];
  Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; writes.push(value); } });
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 4000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => height });
  container.getBoundingClientRect = () => ({ top: 0, bottom: height, height, width: height ? 800 : 0 }) as DOMRect;
  const anchor = document.createElement('div');
  anchor.className = 'chat-message';
  let anchorTop = 40;
  anchor.getBoundingClientRect = () => ({ top: anchorTop, bottom: anchorTop + 100, height: 100, width: 800 }) as DOMRect;
  container.appendChild(anchor);
  return {
    container,
    writes,
    getTop: () => scrollTop,
    setTop: (value: number) => { scrollTop = value; },
    setAnchorTop: (value: number) => { anchorTop = value; },
  };
};

test('a full transcript landing after a session switch leaves the new session alone', async () => {
  const hook = await renderSessionState();
  let resolveLoadAll: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveLoadAll = resolve; }) as never);
  let pending: Promise<void> = Promise.resolve();
  await act(async () => { pending = hook.result.current.loadAllMessages(); });

  hook.rerender({ selected: sessionB });
  await act(async () => {});
  await act(async () => {
    resolveLoadAll(fetched({ total: 999, hasMore: false, offset: 999 }));
    await pending;
  });

  assert.equal(hook.result.current.allMessagesLoaded, false);
  assert.notEqual(hook.result.current.visibleMessageCount, Infinity);
});

test('"Load all" shows the whole transcript and keeps the row on screen where it was', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    await hook.result.current.loadAllMessages();
    // The full window lays 2000px of rows out above the row on screen.
    pane.setAnchorTop(2040);
  });

  assert.equal(hook.result.current.allMessagesLoaded, true);
  assert.equal(hook.result.current.visibleMessageCount, Infinity);
  assert.equal(hook.result.current.hasMoreMessages, false);
  assert.equal(pane.getTop(), 3000);
});

test('a "Load all" whose fetch failed loads nothing and leaves paging open', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);
  // The store reports a failed request through its result, not by throwing.
  store.fetchFromServer.mockImplementationOnce(async () => fetchFailed() as never);

  await act(async () => {
    await hook.result.current.loadAllMessages();
    pane.setAnchorTop(2040);
  });

  assert.equal(hook.result.current.allMessagesLoaded, false);
  assert.equal(hook.result.current.visibleMessageCount, 100);
  assert.equal(hook.result.current.showLoadAllOverlay, false);
  assert.equal(hook.result.current.loadAllJustFinished, false);
  assert.equal(pane.getTop(), 1000, 'no restore was armed');
  // Scrolling to the top still asks for an older page.
  store.fetchMore.mockImplementationOnce(async () => ({ slot, prependedCount: 0 }));
  pane.setTop(10);
  pane.setAnchorTop(40);
  await act(async () => { await hook.result.current.handleScroll(); });
  assert.equal(store.fetchMore.mock.calls.length, 1);
});

test('an older page that failed arms nothing and leaves paging open', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  attachPane(hook, pane.container);
  // fetchMore reports a failure as a page that prepended nothing, with the
  // slot's hasMore untouched.
  store.fetchMore.mockImplementation(async () => ({ slot, prependedCount: 0 }));

  await act(async () => { await hook.result.current.handleScroll(); });
  await act(async () => { await hook.result.current.handleScroll(); });

  assert.equal(store.fetchMore.mock.calls.length, 2, 'the next scroll at the top tries again');
  assert.equal(hook.result.current.allMessagesLoaded, false);
  assert.equal(hook.result.current.visibleMessageCount, 100);
  assert.equal(pane.getTop(), 10);
});

test('a page of older messages landing after a session switch arms nothing', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  attachPane(hook, pane.container);
  const windowBefore = hook.result.current.visibleMessageCount;

  let resolveMore: (value: unknown) => void = () => {};
  store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }) as never);
  let pending: Promise<unknown> = Promise.resolve();
  await act(async () => { pending = hook.result.current.handleScroll(); });
  assert.equal(store.fetchMore.mock.calls.length, 1, 'scrolling near the top asks for an older page');

  hook.rerender({ selected: sessionB });
  await act(async () => {});
  pane.setTop(3400);
  await act(async () => {
    resolveMore({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
    await pending;
  });

  assert.equal(hook.result.current.visibleMessageCount, windowBefore);
  assert.equal(pane.getTop(), 3400);
});

test('"Load earlier" keeps the row on screen where it was', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    hook.result.current.loadEarlierMessages();
    // The widened commit lays 2000px of rows out above the row on screen.
    pane.setAnchorTop(2040);
  });

  assert.equal(pane.getTop(), 3000);
});

test('widening the window of a hidden pane keeps no position to restore', async () => {
  const hook = await renderSessionState();
  const pane = shownPane(0);
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    hook.result.current.loadEarlierMessages();
    pane.setAnchorTop(2040);
  });

  assert.equal(pane.getTop(), 1000);
});

test('a search jump whose transcript lands after a session switch leaves the new session alone', async () => {
  store.getMessages.mockImplementation(() => [{
    id: 'm-0',
    kind: 'text',
    role: 'user',
    provider: 'claude',
    sessionId: sessionA.id,
    content: 'the message the sidebar search found',
    timestamp: '2026-01-01T00:00:00.000Z',
  } as NormalizedMessage]);
  let resolveFull: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
    options?.limit === null ? new Promise((resolve) => { resolveFull = resolve; }) : Promise.resolve(fetched())
  )) as never);
  const hook = await renderSessionState({ ...sessionA, __searchTargetSnippet: 'message the sidebar search found' } as ProjectSession);
  const fullFetches = () => (store.fetchFromServer.mock.calls as unknown[][]).filter(([, options]) => (options as { limit?: unknown })?.limit === null);
  assert.equal(fullFetches().length, 1, 'the jump asks for the whole transcript');

  hook.rerender({ selected: sessionB });
  await act(async () => {});
  assert.equal(hook.result.current.hasMoreMessages, true);
  await act(async () => {
    resolveFull(fetched({ total: 999, hasMore: false, offset: 999 }));
  });

  assert.equal(hook.result.current.allMessagesLoaded, false);
  assert.equal(hook.result.current.hasMoreMessages, true);
  assert.equal(hook.result.current.visibleMessageCount, 100);
});

test('two "Load earlier" clicks before a render show two pages more', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    hook.result.current.loadEarlierMessages();
    hook.result.current.loadEarlierMessages();
  });

  assert.equal(hook.result.current.visibleMessageCount, 300);
});

test('revealing a row already inside the window arms no restore to pull the view back later', async () => {
  store.getMessages.mockImplementation(() => transcript(5));
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(3400);
  attachPane(hook, pane.container);

  await act(async () => { hook.result.current.revealMessage(hook.result.current.chatMessages[2]); });
  // The user then scrolls up 1000px on their own.
  pane.setTop(2400);
  pane.setAnchorTop(1040);
  await act(async () => { await hook.result.current.handleScroll(); });
  assert.equal(hook.result.current.isUserScrolledUp, true);
  // A new message arrives.
  store.getMessages.mockImplementation(() => transcript(6));
  hook.rerender({ selected: sessionA });
  await act(async () => {});

  assert.equal(pane.getTop(), 2400);
});

test('a widen before an older page\'s commit leaves that page\'s restore in place', async () => {
  const hook = await renderSessionState();
  const pane = shownPane();
  attachPane(hook, pane.container);

  let resolveMore: (value: unknown) => void = () => {};
  store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }) as never);
  let pending: Promise<unknown> = Promise.resolve();
  // Near the top: the page's restore is captured with the row at 40px.
  await act(async () => { pending = hook.result.current.handleScroll(); });

  await act(async () => {
    resolveMore({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
    await pending;
    // The view has moved by the time "Load earlier" widens the window too.
    pane.setAnchorTop(640);
    hook.result.current.loadEarlierMessages();
    // The commit lays both out above the row.
    pane.setAnchorTop(2040);
  });

  assert.equal(pane.getTop(), 10 + 2000);
});

test('widening the window behind another tab keeps no position for the return', async () => {
  const hook = await renderSessionState(sessionA, false);
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    hook.result.current.loadEarlierMessages();
    pane.setAnchorTop(2040);
  });
  // Back on the Chat tab, following the bottom wins.
  hook.rerender({ selected: sessionA, active: true });
  await act(async () => {});

  assert.equal(pane.getTop(), 4000);
});

test('revealing a row outside the window keeps the view still through the widened commit', async () => {
  store.getMessages.mockImplementation(() => transcript(150));
  const hook = await renderSessionState();
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    hook.result.current.revealMessage(hook.result.current.chatMessages[10]);
    pane.setAnchorTop(2040);
  });

  assert.ok(hook.result.current.visibleMessageCount > 100);
  assert.equal(pane.getTop(), 3000);
});

test('a search jump keeps the view still through the widened commit', async () => {
  store.getMessages.mockImplementation(() => transcript(150));
  let resolveFull: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
    options?.limit === null ? new Promise((resolve) => { resolveFull = resolve; }) : Promise.resolve(fetched())
  )) as never);
  const hook = await renderSessionState({ ...sessionA, __searchTargetSnippet: 'message number 10 of the' } as ProjectSession);
  const pane = shownPane();
  pane.setTop(1000);
  attachPane(hook, pane.container);

  await act(async () => {
    resolveFull(fetched({ total: 150, hasMore: false, offset: 150 }));
    // Every step up to the widen runs before this macrotask.
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    pane.setAnchorTop(2040);
  });

  assert.ok(hook.result.current.visibleMessageCount > 100);
  assert.equal(pane.getTop(), 3000);
  // Leaving the session drops the jump's pending lookups.
  hook.rerender({ selected: sessionB });
  await act(async () => {});
});

// Leaving a session and coming back to it while a request is in flight makes
// the open session's id match the request's again, but it is a new open: the
// restore, window and jump the request would arm belong to the one it left.
describe('a request that outlives a switch away and back', () => {
  const switchAwayAndBack = async (hook: Awaited<ReturnType<typeof renderSessionState>>) => {
    hook.rerender({ selected: sessionB });
    await act(async () => {});
    hook.rerender({ selected: sessionA });
    await act(async () => {});
  };

  test('a full transcript leaves the reopened session alone', async () => {
    const hook = await renderSessionState();
    let resolveLoadAll: (value: unknown) => void = () => {};
    store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveLoadAll = resolve; }) as never);
    let pending: Promise<void> = Promise.resolve();
    await act(async () => { pending = hook.result.current.loadAllMessages(); });

    await switchAwayAndBack(hook);
    await act(async () => {
      resolveLoadAll(fetched({ total: 999, hasMore: false, offset: 999 }));
      await pending;
    });

    assert.equal(hook.result.current.allMessagesLoaded, false);
    assert.equal(hook.result.current.visibleMessageCount, 100);
  });

  test('a page of older messages arms nothing on the reopened session', async () => {
    const hook = await renderSessionState();
    const pane = shownPane();
    attachPane(hook, pane.container);

    let resolveMore: (value: unknown) => void = () => {};
    store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }) as never);
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => { pending = hook.result.current.handleScroll(); });
    assert.equal(store.fetchMore.mock.calls.length, 1);

    await switchAwayAndBack(hook);
    pane.setTop(3400);
    await act(async () => {
      resolveMore({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
      await pending;
    });

    assert.equal(hook.result.current.visibleMessageCount, 100);
    assert.equal(pane.getTop(), 3400);
  });

  // The search hit's session holds one row the jump would find at once.
  const searchedSession = () => {
    store.getMessages.mockImplementation(() => [{
      id: 'm-0',
      kind: 'text',
      role: 'user',
      provider: 'claude',
      sessionId: sessionA.id,
      content: 'the message the sidebar search found',
      timestamp: '2026-01-01T00:00:00.000Z',
    } as NormalizedMessage]);
    const handlers: { resolve: (value: unknown) => void; reject: (reason: unknown) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    store.fetchFromServer.mockImplementation(((_sessionId: string, options?: { limit?: number | null }) => (
      options?.limit === null
        ? new Promise((resolve, reject) => { handlers.resolve = resolve; handlers.reject = reject; })
        : Promise.resolve(fetched())
    )) as never);
    return handlers;
  };
  // The hit's row, 2000px into the pane's content: centring it in the 600px
  // view writes scrollTop 1750.
  const searchedRowIn = (pane: ReturnType<typeof shownPane>) => {
    const row = document.createElement('div');
    row.setAttribute('data-message-timestamp', '2026-01-01T00:00:00.000Z');
    row.getBoundingClientRect = () => ({ top: 2000 - pane.getTop(), bottom: 2100 - pane.getTop(), height: 100, width: 800 }) as DOMRect;
    pane.container.appendChild(row);
    return row;
  };
  const jumpedToRow = (pane: ReturnType<typeof shownPane>) => pane.writes.includes(1750);
  const renderSearch = () => renderSessionState({ ...sessionA, __searchTargetSnippet: 'message the sidebar search found' } as ProjectSession);
  // Long enough for the jump's first lookup (150ms) to run.
  const waitForLookup = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 250); }); });

  test('a page still loading for the open left behind does not hold up the reopened session\'s', async () => {
    const hook = await renderSessionState();
    const pane = shownPane();
    attachPane(hook, pane.container);
    let resolveStale: (value: unknown) => void = () => {};
    store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }) as never);
    let stale: Promise<unknown> = Promise.resolve();
    await act(async () => { stale = hook.result.current.handleScroll(); });
    assert.equal(store.fetchMore.mock.calls.length, 1);

    await switchAwayAndBack(hook);
    let resolveFresh: (value: unknown) => void = () => {};
    store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }) as never);
    let fresh: Promise<unknown> = Promise.resolve();
    await act(async () => { fresh = hook.result.current.handleScroll(); });
    assert.equal(store.fetchMore.mock.calls.length, 2, 'the reopened session asks for its own page');
    assert.equal(hook.result.current.isLoadingMoreMessages, true);

    await act(async () => {
      resolveStale({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
      await stale;
    });
    assert.equal(hook.result.current.isLoadingMoreMessages, true, 'the stale page does not end the new load');

    await act(async () => {
      resolveFresh({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
      await fresh;
    });
    assert.equal(hook.result.current.isLoadingMoreMessages, false);
  });

  test('a "Load all" still loading for the open left behind does not hold up the reopened session\'s', async () => {
    const hook = await renderSessionState();
    let resolveStale: (value: unknown) => void = () => {};
    store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }) as never);
    let stale: Promise<void> = Promise.resolve();
    await act(async () => { stale = hook.result.current.loadAllMessages(); });

    await switchAwayAndBack(hook);
    assert.equal(hook.result.current.isLoadingAllMessages, false);
    let resolveFresh: (value: unknown) => void = () => {};
    store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }) as never);
    let fresh: Promise<void> = Promise.resolve();
    await act(async () => { fresh = hook.result.current.loadAllMessages(); });
    assert.equal(hook.result.current.isLoadingAllMessages, true);

    await act(async () => {
      resolveStale(fetched({ hasMore: false }));
      await stale;
    });
    assert.equal(hook.result.current.isLoadingAllMessages, true, 'the stale transcript does not end the new load');

    await act(async () => {
      resolveFresh(fetched({ hasMore: false }));
      await fresh;
    });
    assert.equal(hook.result.current.isLoadingAllMessages, false);
    assert.equal(hook.result.current.allMessagesLoaded, true);
  });

  test('a search jump whose fetch fails in the same open searches the messages already loaded', async () => {
    const handlers = searchedSession();
    const hook = await renderSearch();
    const pane = shownPane();
    searchedRowIn(pane);
    attachPane(hook, pane.container);

    await act(async () => { handlers.reject(new Error('offline')); });
    await waitForLookup();

    assert.equal(jumpedToRow(pane), true);
    assert.equal(hook.result.current.allMessagesLoaded, false);
  });

  test('a search jump whose fetch errors in the same open searches the messages already loaded', async () => {
    const handlers = searchedSession();
    const hook = await renderSearch();
    const pane = shownPane();
    searchedRowIn(pane);
    attachPane(hook, pane.container);

    // The store reports a failed request through its result, not by throwing.
    await act(async () => { handlers.resolve(fetchFailed()); });
    await waitForLookup();

    assert.equal(jumpedToRow(pane), true);
    assert.equal(hook.result.current.allMessagesLoaded, false);
    assert.equal(hook.result.current.hasMoreMessages, true);
  });

  test('a search jump whose fetch fails after a session switch leaves the new session alone', async () => {
    const handlers = searchedSession();
    const hook = await renderSearch();
    const pane = shownPane();
    searchedRowIn(pane);
    attachPane(hook, pane.container);

    hook.rerender({ selected: sessionB });
    await act(async () => {});
    await act(async () => { handlers.reject(new Error('offline')); });
    await waitForLookup();

    assert.equal(jumpedToRow(pane), false);
    assert.equal(hook.result.current.visibleMessageCount, 100);
  });

  test('a search jump\'s transcript leaves the reopened session alone', async () => {
    const handlers = searchedSession();
    const hook = await renderSearch();
    const pane = shownPane();
    searchedRowIn(pane);
    attachPane(hook, pane.container);

    await switchAwayAndBack(hook);
    await act(async () => { handlers.resolve(fetched({ total: 999, hasMore: false, offset: 999 })); });
    await waitForLookup();

    assert.equal(hook.result.current.allMessagesLoaded, false);
    assert.equal(jumpedToRow(pane), false);
  });

  test('a search jump whose fetch fails does not jump in the reopened session', async () => {
    const handlers = searchedSession();
    const hook = await renderSearch();
    const pane = shownPane();
    searchedRowIn(pane);
    attachPane(hook, pane.container);

    await switchAwayAndBack(hook);
    await act(async () => { handlers.reject(new Error('offline')); });
    await waitForLookup();

    assert.equal(jumpedToRow(pane), false);
    assert.equal(pane.container.querySelectorAll('.search-highlight-flash').length, 0);
  });
});

test('a page still loading when New Session is clicked does not hold up the next one', async () => {
  // New Session on the same route keeps the selected session, so only its own
  // reset ends the load flags; the page's own `finally` leaves a newer open's
  // flags alone.
  const hook = await renderSessionState();
  const pane = shownPane();
  attachPane(hook, pane.container);
  let resolveStale: (value: unknown) => void = () => {};
  store.fetchMore.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }) as never);
  let stale: Promise<unknown> = Promise.resolve();
  await act(async () => { stale = hook.result.current.handleScroll(); });
  assert.equal(store.fetchMore.mock.calls.length, 1);

  hook.rerender({ selected: sessionA, newSessionTrigger: 1 });
  await act(async () => {});
  assert.equal(hook.result.current.isLoadingMoreMessages, false);
  // The paging comes back with the next refresh (a reconnect's, say).
  await act(async () => { await hook.result.current.requestLatestMessages(sessionA.id); });
  assert.equal(hook.result.current.hasMoreMessages, true);
  store.fetchMore.mockImplementationOnce(async () => ({ slot, prependedCount: 0 }));
  await act(async () => { await hook.result.current.handleScroll(); });

  assert.equal(store.fetchMore.mock.calls.length, 2, 'the next page is asked for');
  await act(async () => {
    resolveStale({ slot: { ...slot, offset: 120 }, prependedCount: 20 });
    await stale;
  });
});

// The store reports a failed request through its result, not by throwing.
describe('a fetch that failed', () => {
  test('fails the export instead of handing it only the rows already loaded', async () => {
    store.getMessages.mockImplementation(() => transcript(3));
    const hook = await renderSessionState();
    store.fetchFromServer.mockImplementationOnce(async () => fetchFailed() as never);

    await assert.rejects(hook.result.current.loadFullTranscript());
  });

  test('refused because the user left the session, fails the export too', async () => {
    store.getMessages.mockImplementation(() => transcript(3));
    const hook = await renderSessionState();
    // The store refuses a request whose `canRequest` no longer holds.
    store.fetchFromServer.mockImplementationOnce(async () => null as never);

    await assert.rejects(hook.result.current.loadFullTranscript());
  });

  test('on reopening a session, pages on from the rows an earlier open left in the store', async () => {
    // The slot's paging describes exactly the rows it still holds, which are
    // what is rendered and what fetchMore pages on from.
    store.fetchFromServer.mockImplementationOnce(async () => fetchFailed({ total: 500, hasMore: true, offset: 100 }) as never);
    const hook = await renderSessionState();
    const pane = shownPane();
    attachPane(hook, pane.container);

    assert.equal(hook.result.current.isLoadingSessionMessages, false);
    assert.equal(hook.result.current.hasMoreMessages, true);
    assert.equal(hook.result.current.totalMessages, 500);
    // Scrolling to the top asks for the page before those rows.
    store.fetchMore.mockImplementationOnce(async () => ({ slot, prependedCount: 0 }));
    await act(async () => { await hook.result.current.handleScroll(); });
    assert.equal(store.fetchMore.mock.calls.length, 1);
  });

  test('on opening a session with nothing loaded before, leaves the paging reset', async () => {
    store.fetchFromServer.mockImplementationOnce(async () => fetchFailed({ fetchedAt: 0, total: 500, hasMore: true, offset: 100 }) as never);
    const hook = await renderSessionState();

    assert.equal(hook.result.current.isLoadingSessionMessages, false);
    assert.equal(hook.result.current.hasMoreMessages, false);
    assert.equal(hook.result.current.totalMessages, 0);
  });
});

test('a first page landing after a switch to another session leaves that session\'s loading and paging alone', async () => {
  const pages = new Map<string, (value: unknown) => void>();
  store.fetchFromServer.mockImplementation(((sessionId: string) => new Promise((resolve) => { pages.set(sessionId, resolve); })) as never);
  const hook = await renderSessionState();
  hook.rerender({ selected: sessionB });
  await act(async () => {});
  assert.equal(hook.result.current.isLoadingSessionMessages, true);

  await act(async () => { pages.get(sessionA.id)!(fetched({ total: 999, hasMore: true, offset: 100 })); });
  assert.equal(hook.result.current.isLoadingSessionMessages, true, 'B is still loading');
  assert.equal(hook.result.current.hasMoreMessages, false);
  assert.equal(hook.result.current.totalMessages, 0);

  await act(async () => { pages.get(sessionB.id)!(fetched({ total: 40, hasMore: false, offset: 40 })); });
  assert.equal(hook.result.current.isLoadingSessionMessages, false);
  assert.equal(hook.result.current.totalMessages, 40);
});

test('a first page still loading when the session is closed leaves no loading flag behind', async () => {
  // The page's own landing leaves a newer open's flag alone, so the session
  // change ends the flag of the open it leaves.
  let resolvePage: (value: unknown) => void = () => {};
  store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }) as never);
  const hook = await renderSessionState();
  assert.equal(hook.result.current.isLoadingSessionMessages, true);

  hook.rerender({ selected: null as unknown as ProjectSession });
  await act(async () => {});
  assert.equal(hook.result.current.isLoadingSessionMessages, false);
  await act(async () => { resolvePage(fetched()); });
  assert.equal(hook.result.current.isLoadingSessionMessages, false);
  assert.equal(hook.result.current.hasMoreMessages, false);
});
