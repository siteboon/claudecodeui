import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { SESSION_MESSAGES_PAGE_SIZE } from '@/modules/chat/utils/sessionMessagePagination';
import { api } from '@/shared/api';
import type { NormalizedMessage, Project, ProjectSession, ServerEvent } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: vi.fn(),
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_ID = 'session-a';
const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};
const session: ProjectSession = { id: SESSION_ID };
const sessionMessages = vi.mocked(api.providers.sessionMessages);
const persisted = new Map<string, string>();

function historyMessage(sessionId: string): NormalizedMessage {
  return {
    id: `${sessionId}-answer`,
    sessionId,
    kind: 'text',
    role: 'assistant',
    provider: 'claude',
    content: persisted.get(sessionId) ?? 'cached answer',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  localStorage.clear();
  persisted.clear();
  sessionMessages.mockReset();
  sessionMessages.mockImplementation(async (sessionId) => new Response(JSON.stringify({
    data: { messages: [historyMessage(sessionId)], total: 1, hasMore: false },
  })));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderSession() {
  const listeners = new Set<(event: ServerEvent) => void>();
  const registeredListeners: Array<(event: ServerEvent) => void> = [];
  const subscribe = (listener: (event: ServerEvent) => void) => {
    listeners.add(listener);
    registeredListeners.push(listener);
    return () => { listeners.delete(listener); };
  };
  const dispatch = (event: ServerEvent) => {
    for (const listener of listeners) listener(event);
  };
  const sendMessage = vi.fn<(message: unknown) => void>();
  const resetStreamingState = vi.fn();
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const lastSeqRef = { current: new Map([[SESSION_ID, 41]]) };
  // This hook only uses socket identity; transport behavior has its own tests.
  const firstSocket = {} as WebSocket;
  const replacementSocket = {} as WebSocket;
  type Props = { ws: WebSocket | null; isActive: boolean; session: ProjectSession | null };
  const props: Props = { ws: firstSocket, isActive: true, session };
  const view = renderHook(
    ({ ws, isActive, session: selectedSession }: Props) => {
      const store = useSessionStore();
      const chat = useChatSessionState({
        isActive,
        selectedProject: project,
        selectedSession,
        ws,
        sendMessage,
        subscribe,
        resetStreamingState,
        statusCheckSentAtRef,
        lastSeqRef,
        sessionStore: store,
      });
      return { chat, store };
    },
    { initialProps: props },
  );
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer'));
  return { ...view, props, replacementSocket, sendMessage, dispatch, registeredListeners };
}

const ack = (sessionId = SESSION_ID): ServerEvent => ({ kind: 'chat_subscribed', sessionId });

test('initial subscription and visibility-only changes do not refresh or resubscribe', async () => {
  const view = await renderSession();
  await act(async () => view.dispatch(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => view.rerender({ ...view.props, isActive: false }));
  await act(async () => view.rerender({ ...view.props, session: { ...session } }));
  expect(view.sendMessage).toHaveBeenCalledTimes(1);
  expect(sessionMessages).toHaveBeenCalledTimes(1);
});

test('replacement waits for its matching ack before fetching and displaying persisted history', async () => {
  const view = await renderSession();
  persisted.set(SESSION_ID, 'finished while disconnected');
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));

  expect(view.sendMessage).toHaveBeenLastCalledWith({
    type: 'chat.subscribe',
    sessions: [{ sessionId: SESSION_ID, lastSeq: 41 }],
  });
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer');

  await act(async () => {
    view.dispatch({ kind: 'chat_subscribed' });
    view.dispatch(ack('unrelated-session'));
  });
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => view.dispatch(ack()));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('finished while disconnected'));
  expect(sessionMessages).toHaveBeenCalledTimes(2);
  expect(sessionMessages).toHaveBeenLastCalledWith(
    SESSION_ID,
    { limit: SESSION_MESSAGES_PAGE_SIZE, offset: 0 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await act(async () => view.dispatch(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(2);
});

test('an ack delivered during send is observed because the listener is already armed', async () => {
  const view = await renderSession();
  persisted.set(SESSION_ID, 'caught up');
  view.sendMessage.mockImplementation(() => view.dispatch(ack()));

  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('caught up'));
  expect(sessionMessages).toHaveBeenCalledTimes(2);
});

test('a hidden replacement subscribes and acknowledges, but fetches only on activation', async () => {
  const view = await renderSession();
  const reconnected = { ...view.props, ws: view.replacementSocket };
  persisted.set(SESSION_ID, 'hidden completion');

  await act(async () => view.rerender({ ...reconnected, isActive: false }));
  expect(view.sendMessage).toHaveBeenCalledTimes(2);
  await act(async () => view.dispatch(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => view.rerender(reconnected));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('hidden completion'));
  expect(view.sendMessage).toHaveBeenCalledTimes(2);
  expect(sessionMessages).toHaveBeenCalledTimes(2);
});

test('activation cannot flush queued or stale-history refreshes before the reconnect ack', async () => {
  const view = await renderSession();
  const reconnected = { ...view.props, ws: view.replacementSocket };
  persisted.set(SESSION_ID, 'acknowledged completion');
  await act(async () => view.rerender({ ...reconnected, isActive: false }));
  // Model an existing hidden completion signal and a cache that aged while hidden.
  await act(async () => view.result.current.chat.requestLatestMessages(SESSION_ID, false));
  const slot = view.result.current.store.getSessionSlot(SESSION_ID);
  if (!slot) throw new Error('Expected hydrated history');
  slot.fetchedAt = Date.now() - 60_000;

  await act(async () => view.rerender(reconnected));
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer');
  expect(view.sendMessage).toHaveBeenCalledTimes(2);

  await act(async () => view.dispatch(ack()));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('acknowledged completion'));
  expect(sessionMessages).toHaveBeenCalledTimes(2);
});

test('a disconnected socket callback cannot acknowledge its replacement', async () => {
  const view = await renderSession();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  await act(async () => view.rerender({ ...view.props, ws: null }));
  const nextSocket = {} as WebSocket;
  await act(async () => view.rerender({ ...view.props, ws: nextSocket }));

  await act(async () => staleListener(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  persisted.set(SESSION_ID, 'current socket completion');
  await act(async () => view.dispatch(ack()));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('current socket completion'));
});

test('switching sessions clears the old pending ack without refreshing the new session', async () => {
  const view = await renderSession();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  persisted.set('session-b', 'other conversation');
  await act(async () => view.rerender({
    ...view.props,
    ws: view.replacementSocket,
    session: { id: 'session-b' },
  }));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('other conversation'));
  expect(sessionMessages).toHaveBeenCalledTimes(2);

  await act(async () => {
    staleListener(ack());
    view.dispatch(ack());
    view.dispatch(ack('session-b'));
  });
  expect(sessionMessages).toHaveBeenCalledTimes(2);
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('other conversation');
});

test('a session selected after an unselected reconnect only performs its initial history load', async () => {
  const view = await renderSession();
  await act(async () => view.rerender({ ...view.props, session: null }));
  await act(async () => view.rerender({ ...view.props, session: null, ws: view.replacementSocket }));
  persisted.set('session-b', 'new selection');
  await act(async () => view.rerender({
    ...view.props,
    session: { id: 'session-b' },
    ws: view.replacementSocket,
  }));
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('new selection'));
  await act(async () => view.dispatch(ack('session-b')));
  expect(sessionMessages).toHaveBeenCalledTimes(2);
});

test('unmount clears an outstanding reconnect acknowledgement', async () => {
  const view = await renderSession();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  view.unmount();

  await act(async () => staleListener(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);
});

test('reconnect notifications never become transcript rows', () => {
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const { result } = renderHook(() => {
    const store = useSessionStore();
    useChatRealtimeHandlers({
      isActive: true,
      subscribe,
      provider: 'claude',
      selectedSession: session,
      currentSessionId: SESSION_ID,
      setTokenBudget: vi.fn(),
      pendingPermissionRequests: [],
      setPendingPermissionRequests: vi.fn(),
      streamTimerRef: { current: null },
      accumulatedStreamRef: { current: '' },
      lastSeqRef: { current: new Map() },
      statusCheckSentAtRef: { current: new Map() },
      requestLatestMessages: vi.fn(async () => {}),
      sessionStore: store,
    });
    return store;
  });
  const message = historyMessage(SESSION_ID);
  act(() => {
    for (const listener of listeners) {
      listener(message);
      listener({ kind: 'websocket_reconnected', timestamp: Date.now() });
    }
  });
  expect(result.current.getMessages(SESSION_ID)).toEqual([message]);
});
