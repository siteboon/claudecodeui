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
    { initialProps: { session: options.session } as { session: ProjectSession; isActive?: boolean } },
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

describe('上一条提问跨页定位', () => {
  it('只补到目标所在页，更早的历史保留分页，不加载全量', async () => {
    const prompt = buildMessage(0, '2026-01-01T00:00:00.000Z');
    const tail = buildMessage(1, '2026-01-01T00:02:00.000Z');
    const messages = new Map([[SESSION_A, [tail]]]);
    const store = createStore(messages);
    const slot = { fetchedAt: 1, status: 'idle' as const, total: 80, offset: 20, hasMore: true };
    store.getSessionSlot.mockImplementation(() => slot);
    store.fetchMore.mockImplementation(async () => {
      slot.offset += 20;
      if (slot.offset === 60) messages.set(SESSION_A, [prompt, tail]);
      return { slot, prependedCount: 20 };
    });
    const { result } = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
    store.fetchFromServer.mockClear();
    const container = createContainer(5000, 500);
    const row = document.createElement('div');
    row.setAttribute('data-message-timestamp', prompt.timestamp);
    row.scrollIntoView = vi.fn();
    container.element.appendChild(row);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => {
      result.current.revealUserPrompt({ type: 'user', content: prompt.content, timestamp: prompt.timestamp });
    });
    act(() => { vi.advanceTimersByTime(600); });
    expect(store.fetchMore).toHaveBeenCalledTimes(2);
    expect(store.fetchMore).toHaveBeenCalledWith(SESSION_A, expect.objectContaining({ limit: 20 }));
    expect(store.fetchFromServer).not.toHaveBeenCalled();
    expect(result.current.hasMoreMessages).toBe(true);
    expect(result.current.allMessagesLoaded).toBe(false);
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(row.classList.contains('search-highlight-flash')).toBe(true);
    container.element.scrollTop = 0;
    await act(async () => { await result.current.handleScroll(); });
    expect(store.fetchMore).toHaveBeenCalledTimes(2);
    await act(async () => { result.current.handleUserHistoryScroll(); });
    expect(store.fetchMore).toHaveBeenCalledTimes(3);
  });

  it('连续点击同一缺失提问合并请求，并按标识避开同时间戳的后续提问', async () => {
    const prompt = buildMessage(0, '2026-01-01T00:00:00.000Z');
    const later = { ...prompt, id: 'later', content: '同时间但在后面的提问' };
    const tail = buildMessage(1, '2026-01-01T00:02:00.000Z');
    const messages = new Map([[SESSION_A, [later, tail]]]);
    const store = createStore(messages);
    const slot = { fetchedAt: 1, status: 'idle' as const, total: 80, offset: 20, hasMore: true };
    store.getSessionSlot.mockImplementation(() => slot);
    let finish = () => {};
    store.fetchMore.mockImplementation(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      messages.set(SESSION_A, [prompt, later, tail]);
      slot.offset += 20;
      return { slot, prependedCount: 20 };
    });
    const { result } = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
    const container = createContainer(5000, 500);
    const row = document.createElement('div');
    row.setAttribute('data-message-id', prompt.id);
    row.setAttribute('data-message-timestamp', prompt.timestamp);
    row.scrollIntoView = vi.fn();
    container.element.appendChild(row);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    const target = { type: 'user', content: prompt.content, timestamp: prompt.timestamp, sourceMessageId: prompt.id };
    await act(async () => { result.current.revealUserPrompt(target); });
    await act(async () => { result.current.revealUserPrompt(target); });
    expect(store.fetchMore).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(store.fetchMore).toHaveBeenCalledTimes(1);
    expect(row.scrollIntoView).toHaveBeenCalled();
  });
});

describe('分页定位的恢复与供应商兼容', () => {
  it('Codex 目标 id 变化时停在目标页，隐藏标签后可继续完成 DOM 定位，键盘可恢复翻页', async () => {
    const saved = { ...buildMessage(0, '2026-01-01T00:00:00.000Z'), provider: 'codex' as const, id: 'peek-id' };
    const persisted = { ...saved, id: 'loaded-id' };
    const tail = { ...buildMessage(1, '2026-01-01T00:02:00.000Z'), provider: 'codex' as const };
    const messages = new Map([[SESSION_A, [tail]]]);
    const store = createStore(messages);
    const slot = { fetchedAt: 1, status: 'idle' as const, total: 80, offset: 20, hasMore: true };
    store.getSessionSlot.mockImplementation(() => slot);
    store.fetchMore.mockImplementation(async () => {
      messages.set(SESSION_A, [persisted, tail]);
      slot.offset += 20;
      return { slot, prependedCount: 20 };
    });
    const session = { id: SESSION_A } as ProjectSession;
    const { result, rerender } = await renderChatSessionState({ session, store });
    const container = createContainer(5000, 500);
    const row = document.createElement('div');
    row.setAttribute('data-message-id', persisted.id);
    row.setAttribute('data-message-timestamp', persisted.timestamp);
    row.scrollIntoView = vi.fn();
    container.element.appendChild(row);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => { result.current.revealUserPrompt({ type: 'user', timestamp: saved.timestamp, content: saved.content, sourceMessageId: saved.id, sourceMessage: saved }); });
    expect(store.fetchMore).toHaveBeenCalledTimes(1);
    act(() => { rerender({ session, isActive: false }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(row.scrollIntoView).not.toHaveBeenCalled();
    await act(async () => { rerender({ session, isActive: true }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(row.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(store.fetchMore).toHaveBeenCalledTimes(1);
    container.element.scrollTop = 0;
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(store.fetchMore).toHaveBeenCalledTimes(2);
  });
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
