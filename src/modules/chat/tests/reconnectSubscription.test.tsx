import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
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
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Only socket identity and close are consumed here; transport reconnection is
// exercised separately by webSocketContext.test.tsx.
class FakeWebSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly bufferedAmount = 0;
  readonly extensions = '';
  readonly protocol = '';
  readonly url = 'ws://localhost/ws';
  binaryType: BinaryType = 'blob';
  readyState: number = this.OPEN;
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onerror: WebSocket['onerror'] = null;
  onclose: WebSocket['onclose'] = null;
  send = vi.fn<WebSocket['send']>();
  close = vi.fn<WebSocket['close']>(() => {
    this.readyState = this.CLOSED;
    const event = new CloseEvent('close');
    this.onclose?.call(this, event);
    this.dispatchEvent(event);
  });
}

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
  const firstSocket = new FakeWebSocket();
  const replacementSocket = new FakeWebSocket();
  type Props = {
    ws: WebSocket | null;
    isActive: boolean;
    session: ProjectSession | null;
    beforePassiveCleanup?: () => void;
  };
  const props: Props = { ws: firstSocket, isActive: true, session };
  const view = renderHook(
    ({ ws, isActive, session: selectedSession, beforePassiveCleanup }: Props) => {
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
      useLayoutEffect(() => { beforePassiveCleanup?.(); }, [beforePassiveCleanup]);
      return { chat, store };
    },
    { initialProps: props },
  );
  await waitFor(() => expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer'));
  return { ...view, props, firstSocket, replacementSocket, sendMessage, dispatch, registeredListeners };
}

const ack = (sessionId = SESSION_ID): ServerEvent => ({ kind: 'chat_subscribed', sessionId });

test('initial subscription and visibility-only changes do not refresh or resubscribe', async () => {
  const view = await renderSession();
  vi.useFakeTimers();
  await act(async () => view.dispatch(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => view.rerender({ ...view.props, isActive: false }));
  await act(async () => view.rerender({ ...view.props, session: { ...session } }));
  expect(view.sendMessage).toHaveBeenCalledTimes(1);
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(view.firstSocket.close).not.toHaveBeenCalled();
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

test('a missing reconnect ack closes the socket despite protocol errors and pongs, then catches up after reattachment', async () => {
  const view = await renderSession();
  vi.useFakeTimers();
  persisted.set(SESSION_ID, 'finished during failed attachment');
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners.at(-1);
  if (!staleListener) throw new Error('Expected subscription listener');

  await act(async () => {
    view.dispatch({ kind: 'protocol_error', message: 'Unrelated request failed' });
    view.dispatch({ kind: 'chat_subscribed' });
    view.dispatch(ack('unrelated-session'));
    view.dispatch({ kind: 'pong', nonce: 'successful-heartbeat' });
    view.registeredListeners[0]?.(ack());
    await vi.advanceTimersByTimeAsync(9_999);
  });
  expect(view.replacementSocket.close).not.toHaveBeenCalled();
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(view.replacementSocket.close).toHaveBeenCalledTimes(1);
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer');

  // Model the provider's close -> disconnected -> replacement-open lifecycle.
  await act(async () => view.rerender({ ...view.props, ws: null }));
  const nextSocket = new FakeWebSocket();
  await act(async () => view.rerender({ ...view.props, ws: nextSocket }));
  expect(view.sendMessage).toHaveBeenCalledTimes(3);
  expect(view.sendMessage).toHaveBeenLastCalledWith({
    type: 'chat.subscribe',
    sessions: [{ sessionId: SESSION_ID, lastSeq: 41 }],
  });
  await act(async () => staleListener(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  persisted.set(SESSION_ID, 'latest completion after reattachment');
  await act(async () => view.dispatch(ack()));
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('latest completion after reattachment');
  expect(sessionMessages).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(nextSocket.close).not.toHaveBeenCalled();
});

test('an ack delivered during send is observed because the listener is already armed', async () => {
  const view = await renderSession();
  vi.useFakeTimers();
  persisted.set(SESSION_ID, 'caught up');
  view.sendMessage.mockImplementation(() => view.dispatch(ack()));

  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('caught up');
  expect(sessionMessages).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(view.replacementSocket.close).not.toHaveBeenCalled();
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

test('a hidden missing-ack timeout reattaches without fetching until activation', async () => {
  const view = await renderSession();
  vi.useFakeTimers();
  const hidden = { ...view.props, isActive: false };
  persisted.set(SESSION_ID, 'completed while hidden');
  await act(async () => view.rerender({ ...hidden, ws: view.replacementSocket }));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(view.replacementSocket.close).toHaveBeenCalledTimes(1);
  expect(sessionMessages).toHaveBeenCalledTimes(1);

  await act(async () => view.rerender({ ...hidden, ws: null }));
  const nextSocket = new FakeWebSocket();
  await act(async () => view.rerender({ ...hidden, ws: nextSocket }));
  await act(async () => view.dispatch(ack()));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(nextSocket.close).not.toHaveBeenCalled();
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('cached answer');
  expect(view.sendMessage).toHaveBeenCalledTimes(3);

  await act(async () => view.rerender({ ...view.props, ws: nextSocket }));
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('completed while hidden');
  expect(sessionMessages).toHaveBeenCalledTimes(2);
  expect(view.sendMessage).toHaveBeenCalledTimes(3);
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
  vi.useFakeTimers();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  await act(async () => view.rerender({ ...view.props, ws: null }));
  const nextSocket = new FakeWebSocket();
  await act(async () => view.rerender({ ...view.props, ws: nextSocket }));

  await act(async () => staleListener(ack()));
  expect(sessionMessages).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(view.replacementSocket.close).not.toHaveBeenCalled();
  expect(nextSocket.close).not.toHaveBeenCalled();
  persisted.set(SESSION_ID, 'current socket completion');
  await act(async () => view.dispatch(ack()));
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('current socket completion');
});

test('switching sessions at the ack deadline keeps the socket open and loads the new session', async () => {
  const view = await renderSession();
  vi.useFakeTimers();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  persisted.set('session-b', 'other conversation');
  await act(async () => view.rerender({
    ...view.props,
    ws: view.replacementSocket,
    session: { id: 'session-b' },
    // The old deadline can run after render updates the session ref but before
    // the subscription effect has cleaned up its previous timer.
    beforePassiveCleanup: () => { vi.advanceTimersByTime(10_000); },
  }));
  expect(view.result.current.chat.chatMessages[0]?.content).toBe('other conversation');
  expect(sessionMessages).toHaveBeenCalledTimes(2);

  await act(async () => {
    staleListener(ack());
    view.dispatch(ack());
    view.dispatch(ack('session-b'));
  });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(view.replacementSocket.close).not.toHaveBeenCalled();
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
  vi.useFakeTimers();
  await act(async () => view.rerender({ ...view.props, ws: view.replacementSocket }));
  const staleListener = view.registeredListeners[view.registeredListeners.length - 1];
  if (!staleListener) throw new Error('Expected subscription listener');
  view.unmount();

  await act(async () => staleListener(ack()));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(view.replacementSocket.close).not.toHaveBeenCalled();
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
