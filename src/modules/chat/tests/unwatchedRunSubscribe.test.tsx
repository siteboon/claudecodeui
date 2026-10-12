import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { Project, ProjectSession, ServerEvent, SessionActivityMap } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * A queued or scheduled message is sent by the server with no browser
 * attached, so its run streams to nobody. The viewed session showed as busy
 * while the message that started the turn, and its reply, stayed off screen
 * until the turn ended (#1498). The chat view has to subscribe to such a run
 * from its first event — and only to such a run: re-subscribing to one this
 * socket already receives would replay it twice.
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
const session = { id: 'session-a', summary: 'A', lastActivity: '2026-01-01T00:00:00.000Z', messageCount: 1 } as ProjectSession;

const store = {
  fetchFromServer: vi.fn(async () => ({ fetchedAt: 1, status: 'idle' as const, total: 0, hasMore: false, offset: 0 })),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn(() => []),
  getSessionSlot: vi.fn(() => ({ fetchedAt: 1, status: 'idle' as const, total: 0, hasMore: false, offset: 0 })),
};

// One socket for the whole test, as in the app: a new one is a reconnect.
const socket = {} as WebSocket;

const busy: SessionActivityMap = new Map([
  ['session-a', { statusText: null, canInterrupt: true, startedAt: 1 }],
]);
const idle: SessionActivityMap = new Map();

type Props = { processingSessions: SessionActivityMap; externalMessageUpdate: number };

async function renderSessionState() {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const sendMessage = vi.fn();
  const watchedRunSessionsRef = { current: new Set<string>() };
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  // The session's previous run went up to seq 12; a new run starts at 1.
  const lastSeqRef = { current: new Map([['session-a', 12]]) };
  const hook = renderHook(
    ({ processingSessions, externalMessageUpdate }: Props) =>
      useChatSessionState({
        isActive: true,
        selectedProject: project,
        selectedSession: session,
        ws: socket,
        sendMessage,
        externalMessageUpdate,
        resetStreamingState: vi.fn(),
        statusCheckSentAtRef,
        lastSeqRef,
        watchedRunSessionsRef,
        sessionStore: store as never,
        processingSessions,
      }),
    { initialProps: { processingSessions: idle, externalMessageUpdate: 0 } },
  );

  // Opening the session subscribes once; its ack reports nothing running.
  assert.equal(sendMessage.mock.calls.length, 1);
  watchedRunSessionsRef.current.delete('session-a');
  sendMessage.mockClear();

  const subscribes = () => sendMessage.mock.calls
    .map(([frame]) => frame as { type: string; sessions: Array<{ sessionId: string; lastSeq: number }> })
    .filter((frame) => frame.type === 'chat.subscribe');

  return { hook, subscribes, watchedRunSessionsRef };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('a run this tab did not start is subscribed to from its first event', async () => {
  const { hook, subscribes } = await renderSessionState();

  // The running-sessions poll reports the server-sent turn.
  await act(async () => {
    hook.rerender({ processingSessions: busy, externalMessageUpdate: 0 });
  });

  assert.deepEqual(subscribes().map((frame) => frame.sessions), [[{ sessionId: 'session-a', lastSeq: 0 }]]);

  // Further polls about the same run do not subscribe again.
  await act(async () => {
    hook.rerender({ processingSessions: new Map(busy), externalMessageUpdate: 0 });
  });
  assert.equal(subscribes().length, 1);
});

test('a transcript change on an idle-looking session subscribes before the poll notices', async () => {
  const { hook, subscribes } = await renderSessionState();

  await act(async () => {
    hook.rerender({ processingSessions: idle, externalMessageUpdate: 1 });
  });

  assert.deepEqual(subscribes().map((frame) => frame.sessions), [[{ sessionId: 'session-a', lastSeq: 0 }]]);
});

test('a run this tab is already watching is not subscribed to again', async () => {
  const { hook, subscribes, watchedRunSessionsRef } = await renderSessionState();

  // The composer's own send marks the run watched as it dispatches it.
  watchedRunSessionsRef.current.add('session-a');
  await act(async () => {
    hook.rerender({ processingSessions: busy, externalMessageUpdate: 1 });
  });

  assert.equal(subscribes().length, 0);
});

const renderHandlers = (getStartedAt: () => number | null) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const watchedRunSessionsRef = { current: new Set<string>() };
  const statusCheckSentAtRef = { current: new Map<string, number>() };

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'session-a' } as ProjectSession,
    currentSessionId: 'session-a',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef,
    watchedRunSessionsRef,
    getSessionActivity: () => {
      const startedAt = getStartedAt();
      return startedAt === null ? undefined : { statusText: null, canInterrupt: true, startedAt };
    },
    requestLatestMessages: async () => {},
    sessionStore: { appendRealtime: () => {}, getMessages: () => [] } as unknown as SessionStore,
  }));

  const dispatch = (event: Record<string, unknown>) => listener?.({ sessionId: 'session-a', ...event } as unknown as ServerEvent);
  return { dispatch, watchedRunSessionsRef, statusCheckSentAtRef };
};

test('the watched set follows acks, live frames and the end of the run', () => {
  const { dispatch, watchedRunSessionsRef, statusCheckSentAtRef } = renderHandlers(() => null);

  dispatch({ kind: 'chat_subscribed', isProcessing: true, pendingPermissions: [] });
  assert.equal(watchedRunSessionsRef.current.has('session-a'), true);

  dispatch({ kind: 'complete', seq: 4, exitCode: 0, success: true });
  assert.equal(watchedRunSessionsRef.current.has('session-a'), false, 'the next run starts unwatched');

  dispatch({ kind: 'text', role: 'assistant', content: 'hi', seq: 1 });
  assert.equal(watchedRunSessionsRef.current.has('session-a'), true, 'a live frame means this socket gets the run');

  statusCheckSentAtRef.current.set('session-a', 100);
  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });
  assert.equal(watchedRunSessionsRef.current.has('session-a'), false);
});

test('an idle ack older than this tab\'s own send keeps that send watched', () => {
  // The send started at 200, after the subscribe that this ack answers (100).
  const { dispatch, watchedRunSessionsRef, statusCheckSentAtRef } = renderHandlers(() => 200);

  statusCheckSentAtRef.current.set('session-a', 100);
  watchedRunSessionsRef.current.add('session-a');
  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });

  assert.equal(watchedRunSessionsRef.current.has('session-a'), true);
});
