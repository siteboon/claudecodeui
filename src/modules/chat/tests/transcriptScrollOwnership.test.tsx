import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The transcript has several legitimate scroll writers. These tests pin
 * ownership to the viewed session and to the reader's latest gesture.
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
 * scrollTop emits nothing. These are the exact reads the scroll code makes.
 */
function createContainer(scrollHeight: number, clientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let scrollTop = scrollHeight - clientHeight;

  Object.defineProperty(element, 'scrollHeight', { get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });

  return { element: element as HTMLDivElement, writes, scrollHeight };
}

function createStore(
  messagesBySession: Map<string, NormalizedMessage[]>,
  hasMoreBySession: Record<string, boolean> = {},
) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: hasMoreBySession[sessionId] ?? false,
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
  externalMessageUpdate?: number;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  return renderHook(
    ({ session, externalMessageUpdate }: {
      session: ProjectSession;
      externalMessageUpdate?: number;
    }) =>
      useChatSessionState({
        isActive: true,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(),
        externalMessageUpdate,
        resetStreamingState: vi.fn(),
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: options.store as never,
      }),
    {
      initialProps: {
        session: options.session,
        externalMessageUpdate: options.externalMessageUpdate,
      },
    },
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  // Search jump retries use timers. Layout is otherwise driven explicitly by
  // the synthetic scroll container below.
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('transcript follow ownership', () => {
  it('does not yank the view back down after the user starts reading upward', async () => {
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

    // A 30px reading gesture. It sits inside the 50px `isNearBottom`
    // tolerance and emits a scroll event of its own, so the flag it sets has
    // to survive the handler that event runs.
    act(() => {
      result.current.handleUserScrollGesture();
    });
    container.element.scrollTop = container.scrollHeight - 500 - 30;
    await act(async () => {
      await result.current.handleScroll();
    });
    container.writes.length = 0;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({
        session: { id: SESSION_A } as ProjectSession,
        externalMessageUpdate: undefined,
      });
    });

    assert.deepEqual(
      container.writes,
      [],
      `a reader-owned viewport must not follow new rows; got ${JSON.stringify(container.writes)}`,
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
    container.writes.length = 0;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({
        session: { id: SESSION_A } as ProjectSession,
        externalMessageUpdate: undefined,
      });
    });

    expect(container.writes).toContain(container.scrollHeight);
  });
});

describe('history page ownership', () => {
  it('discards an older A page after navigating A to B to A', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:01.000Z')]],
    ]);
    const store = createStore(messages, { [SESSION_A]: true });
    type HistoryPage = {
      slot: {
        fetchedAt: number;
        status: 'idle';
        total: number;
        hasMore: boolean;
        offset: number;
      };
      prependedCount: number;
    };
    let resolvePage!: (value: HistoryPage) => void;
    const page = new Promise<HistoryPage>((resolve) => {
      resolvePage = resolve;
    });
    store.fetchMore.mockImplementationOnce(() => page);

    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    await act(async () => {});

    const container = createContainer(5000, 500);
    container.element.scrollTop = 0;
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    let staleRequest!: Promise<void>;
    act(() => {
      staleRequest = result.current.handleScroll();
    });

    await act(async () => {
      rerender({
        session: { id: SESSION_B } as ProjectSession,
        externalMessageUpdate: undefined,
      });
      await Promise.resolve();
    });
    await act(async () => {
      rerender({
        session: { id: SESSION_A } as ProjectSession,
        externalMessageUpdate: undefined,
      });
      await Promise.resolve();
    });

    await act(async () => {
      resolvePage({
        slot: {
          fetchedAt: 2,
          status: 'idle',
          total: 999,
          hasMore: false,
          offset: 999,
        },
        prependedCount: 20,
      });
      await staleRequest;
    });

    assert.notEqual(
      result.current.totalMessages,
      999,
      'a page launched by the previous visit to A must not write into the new visit',
    );
    assert.equal(result.current.isLoadingMoreMessages, false);
  });
});


describe('reconnect ownership', () => {
  it('does not scroll the next session when the previous session refresh finishes', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:01.000Z')]],
    ]);
    const store = createStore(messages);
    type RefreshResult = {
      slot: {
        fetchedAt: number;
        status: 'idle';
        total: number;
        hasMore: boolean;
        offset: number;
      };
      applied: boolean;
      changed: boolean;
      deferred: boolean;
    };
    let resolveRefresh!: (value: RefreshResult) => void;
    const refresh = new Promise<RefreshResult>((resolve) => {
      resolveRefresh = resolve;
    });
    store.refreshLatestFromServer.mockImplementationOnce(() => refresh);

    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    await act(async () => {
      rerender({
        session: { id: SESSION_A } as ProjectSession,
        externalMessageUpdate: 1,
      });
      await Promise.resolve();
    });
    await act(async () => {
      rerender({
        session: { id: SESSION_B } as ProjectSession,
        externalMessageUpdate: 1,
      });
      await Promise.resolve();
    });
    container.writes.length = 0;

    await act(async () => {
      resolveRefresh({
        slot: {
          fetchedAt: 2,
          status: 'idle',
          total: 1,
          hasMore: false,
          offset: 1,
        },
        applied: true,
        changed: false,
        deferred: false,
      });
      await vi.advanceTimersByTimeAsync(250);
    });

    assert.deepEqual(
      container.writes,
      [],
      'a reconnect refresh must not carry a bottom-follow into the next session',
    );
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
      rerender({
        session: { id: SESSION_B } as ProjectSession,
        externalMessageUpdate: undefined,
      });
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
