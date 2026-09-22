import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import type { ChatMessage, NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * A first page of history that is shorter than the pane cannot be scrolled:
 * no `scroll` event, no scrollbar and nothing for Home/PageUp to move. The
 * transcript header used to answer that state with a "scroll up to load more"
 * hint rendered as plain spans, so the rest of the conversation was reachable
 * only by a wheel or touch gesture over the pane — undiscoverable, and absent
 * for a keyboard user. These cover the two halves of the fix: the header's
 * controls are real buttons, and the one they call fetches an older page
 * without needing a gesture.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

/* ---------------------------------------------------------------- */
/*  The header's controls                                            */
/* ---------------------------------------------------------------- */

function renderPane(overrides: Partial<ComponentProps<typeof ChatMessagesPane>> = {}) {
  const loadOlderMessagesPage = vi.fn();
  const loadAllMessages = vi.fn();

  const message = {
    type: 'assistant',
    content: 'latest turn',
    timestamp: new Date('2026-09-01T08:00:00.000Z'),
  } as unknown as ChatMessage;

  const props = {
    scrollContainerRef: createRef<HTMLDivElement>(),
    onWheel: vi.fn(),
    onTouchMove: vi.fn(),
    isLoadingSessionMessages: false,
    chatMessages: [message],
    selectedSession: { id: 'session-a' } as ProjectSession,
    currentSessionId: 'session-a',
    provider: 'claude' as const,
    setProvider: vi.fn(),
    textareaRef: createRef<HTMLTextAreaElement>(),
    providerModels: {} as ComponentProps<typeof ChatMessagesPane>['providerModels'],
    setProviderModel: vi.fn(),
    providerModelCatalog: {},
    providerModelActions: {} as ComponentProps<typeof ChatMessagesPane>['providerModelActions'],
    providerModelsLoading: false,
    tasksEnabled: false,
    isTaskMasterInstalled: false,
    setInput: vi.fn(),
    isLoadingMoreMessages: false,
    hasMoreMessages: true,
    totalMessages: 1000,
    sessionMessagesCount: 20,
    visibleMessageCount: 100,
    // Empty so the header renders without mounting the message rows, which are
    // not what these tests are about.
    visibleMessages: [],
    loadEarlierMessages: vi.fn(),
    loadOlderMessagesPage,
    revealMessage: vi.fn(),
    sendMessage: vi.fn(),
    loadAllMessages,
    allMessagesLoaded: false,
    isLoadingAllMessages: false,
    loadAllJustFinished: false,
    showLoadAllOverlay: false,
    createDiff: () => null,
    onGrantToolPermission: () => ({ success: true }),
    selectedProject: project,
    ...overrides,
  } as ComponentProps<typeof ChatMessagesPane>;

  const view = render(<ChatMessagesPane {...props} />);
  return { ...view, loadOlderMessagesPage, loadAllMessages };
}

describe('transcript header while more history exists', () => {
  it('offers real buttons, not a hint that a short page cannot act on', () => {
    const { loadOlderMessagesPage, loadAllMessages } = renderPane();

    assert.match(document.body.textContent ?? '', /Showing 20 of 1000 messages/);

    const loadEarlier = screen.getByRole('button', { name: 'Load earlier messages' });
    const loadAll = screen.getByRole('button', { name: 'Load all messages' });
    assert.equal(loadEarlier.getAttribute('type'), 'button');
    assert.equal(loadAll.getAttribute('type'), 'button');

    fireEvent.click(loadEarlier);
    fireEvent.click(loadAll);

    assert.equal(loadOlderMessagesPage.mock.calls.length, 1);
    assert.equal(loadAllMessages.mock.calls.length, 1);
  });

  it('drops the controls once everything is loaded', () => {
    renderPane({ hasMoreMessages: false, allMessagesLoaded: true });

    assert.equal(screen.queryByRole('button', { name: 'Load earlier messages' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Load all messages' }), null);
  });
});

/* ---------------------------------------------------------------- */
/*  The page loader behind the "load earlier" button                 */
/* ---------------------------------------------------------------- */

const SESSION = 'session-a';

const buildMessage = (index: number): NormalizedMessage => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: SESSION,
  content: `message ${index}`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
} as NormalizedMessage);

/**
 * jsdom has no layout, so a pane reports 0 for every box. This is the exact
 * shape the bug needs: content no taller than the pane, parked at the top,
 * which is why no `scroll` event can ever fire.
 */
function createUnscrollableContainer() {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollHeight', { get: () => 600 });
  Object.defineProperty(element, 'clientHeight', { get: () => 600 });
  Object.defineProperty(element, 'scrollTop', { get: () => 0, set: () => {} });
  return element as HTMLDivElement;
}

function createStore(pages: { prependedCount: number; hasMore: boolean }[]) {
  const messages: NormalizedMessage[] = [buildMessage(0), buildMessage(1)];
  let hasMore = true;
  const fetchMore = vi.fn(async () => {
    const page = pages.shift() ?? { prependedCount: 0, hasMore: false };
    for (let index = 0; index < page.prependedCount; index++) {
      messages.unshift(buildMessage(-messages.length - index));
    }
    hasMore = page.hasMore;
    return {
      slot: { fetchedAt: 1, status: 'idle' as const, total: 1000, hasMore, offset: messages.length },
      prependedCount: page.prependedCount,
    };
  });

  return {
    fetchMore,
    fetchFromServer: vi.fn(async () => ({
      fetchedAt: 1, status: 'idle' as const, total: 1000, hasMore: true, offset: messages.length,
    })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async () => ({
      slot: { fetchedAt: 1, status: 'idle' as const, total: 1000, hasMore, offset: messages.length },
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn(() => messages),
    getSessionSlot: vi.fn(() => ({
      fetchedAt: 1, status: 'idle' as const, total: 1000, hasMore, offset: messages.length,
    })),
  };
}

async function renderChatSessionState(store: ReturnType<typeof createStore>) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  return renderHook(() =>
    useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: { id: SESSION } as ProjectSession,
      ws: null,
      sendMessage: vi.fn(),
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe('loadOlderMessagesPage', () => {
  it('fetches an older page from a pane that cannot scroll', async () => {
    const store = createStore([{ prependedCount: 20, hasMore: true }]);
    const { result } = await renderChatSessionState(store);

    await act(async () => { await Promise.resolve(); });
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current =
      createUnscrollableContainer();

    await act(async () => {
      result.current.loadOlderMessagesPage();
      await Promise.resolve();
    });

    expect(store.fetchMore).toHaveBeenCalledTimes(1);
  });

  it('stops once the server reports there is nothing older left', async () => {
    const store = createStore([{ prependedCount: 20, hasMore: false }]);
    const { result } = await renderChatSessionState(store);

    await act(async () => { await Promise.resolve(); });
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current =
      createUnscrollableContainer();

    await act(async () => {
      result.current.loadOlderMessagesPage();
      await Promise.resolve();
    });
    expect(store.fetchMore).toHaveBeenCalledTimes(1);

    // The button is gone at this point, but a queued click must not re-request.
    await act(async () => {
      result.current.loadOlderMessagesPage();
      await Promise.resolve();
    });
    expect(store.fetchMore).toHaveBeenCalledTimes(1);
    expect(result.current.hasMoreMessages).toBe(false);
  });

  it('does nothing before the pane is mounted', async () => {
    const store = createStore([{ prependedCount: 20, hasMore: true }]);
    const { result } = await renderChatSessionState(store);

    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      result.current.loadOlderMessagesPage();
      await Promise.resolve();
    });

    expect(store.fetchMore).not.toHaveBeenCalled();
  });
});
