import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type {
  Project,
  ProjectSession,
  RunReplayPosition,
  ServerEvent,
  SessionActivity,
  SessionActivityMap,
  WatchedRunSource,
} from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * A queued or scheduled message is sent by the server with no browser
 * attached, so its run streams to nobody. The viewed session showed as busy
 * while the message that started the turn, and its reply, stayed off screen
 * until the turn ended (#1498). The chat view has to subscribe to such a run
 * from its first event, and only to such a run. Every run of a session starts
 * again at seq 1, so what counts as "such a run" — and how much of it this
 * socket has already shown — is tracked per run, not per session.
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
const background: SessionActivityMap = new Map([
  ['session-a', { statusText: null, canInterrupt: false, startedAt: 1, background: true, tasks: [] }],
]);
const idle: SessionActivityMap = new Map();

type Props = { processingSessions: SessionActivityMap; externalMessageUpdate: number };
type SubscribeFrame = { type: string; sessions: Array<{ sessionId: string; lastSeq: number; runId?: string }> };

/**
 * Mounts the chat view's two hooks the way ChatInterface does: one socket,
 * one set of shared refs, so a frame the handler sees changes what the
 * session state subscribes to.
 */
async function renderChatView(options: {
  initialProcessing?: SessionActivityMap;
  lastSeq?: Map<string, RunReplayPosition>;
  getSessionActivity?: () => SessionActivity | undefined;
} = {}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const sendMessage = vi.fn();
  const watchedRunSessionsRef = { current: new Map<string, WatchedRunSource>() };
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const lastSeqRef = { current: options.lastSeq ?? new Map<string, RunReplayPosition>() };
  const appended: Array<Record<string, unknown>> = [];
  let listener: ((event: ServerEvent) => void) | null = null;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: session,
    currentSessionId: 'session-a',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef,
    statusCheckSentAtRef,
    watchedRunSessionsRef,
    getSessionActivity: options.getSessionActivity ?? (() => undefined),
    // ChatInterface hands the session state's subscribe to the handlers.
    onIdleAckMissedRun: (sessionId) => hook.result.current.subscribeToUnwatchedRun(sessionId),
    requestLatestMessages: async () => {},
    onSessionBackground: () => {},
    onSessionIdle: () => {},
    onSessionProcessing: () => {},
    sessionStore: {
      appendRealtime: (_sid: string, message: Record<string, unknown>) => { appended.push(message); },
      getMessages: () => [],
    } as unknown as SessionStore,
  }));

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
    { initialProps: { processingSessions: options.initialProcessing ?? idle, externalMessageUpdate: 0 } },
  );

  const dispatch = (event: Record<string, unknown>) =>
    listener?.({ sessionId: 'session-a', ...event } as unknown as ServerEvent);
  const subscribes = () => sendMessage.mock.calls
    .map(([frame]) => frame as SubscribeFrame)
    .filter((frame) => frame.type === 'chat.subscribe');
  const poll = async (processingSessions: SessionActivityMap, externalMessageUpdate = 0) => {
    await act(async () => {
      hook.rerender({ processingSessions, externalMessageUpdate });
    });
  };

  return { hook, dispatch, subscribes, poll, appended, watchedRunSessionsRef, lastSeqRef };
}

/** Opens the view and answers its subscribe with "nothing running". */
async function renderIdleChatView(options: Parameters<typeof renderChatView>[0] = {}) {
  const view = await renderChatView(options);
  assert.equal(view.subscribes().length, 1, 'opening the session subscribes once');
  view.dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });
  return view;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('a run this tab did not start is subscribed to, with the run its position came from', async () => {
  // The session's previous run went up to seq 12; the server-sent one starts at 1.
  const { subscribes, poll } = await renderIdleChatView({
    lastSeq: new Map([['session-a', { runId: 'run-1', seq: 12 }]]),
  });

  // The running-sessions poll reports the server-sent turn.
  await poll(busy);
  // run-1 is not the run in progress, so the server replays that one whole.
  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 12, runId: 'run-1' }]);
  assert.equal(subscribes().length, 2);

  // Further polls about the same run do not subscribe again.
  await poll(new Map(busy));
  assert.equal(subscribes().length, 2);
});

test('a transcript change on an idle-looking session subscribes before the poll notices', async () => {
  const { subscribes, poll } = await renderIdleChatView();

  await poll(idle, 1);

  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 0 }]);
  assert.equal(subscribes().length, 2);
});

test('a claimed queued message is subscribed to and its history read, in case its run already ended', async () => {
  const { hook, subscribes } = await renderIdleChatView();
  store.refreshLatestFromServer.mockClear();

  act(() => hook.result.current.followClaimedQueuedMessage('session-a'));

  assert.equal(subscribes().length, 2);
  assert.equal(store.refreshLatestFromServer.mock.calls[0]?.[0], 'session-a');
});

test('opening a busy session subscribes once, not again for the poll that says it is busy', async () => {
  const { subscribes } = await renderChatView({ initialProcessing: busy });

  assert.equal(subscribes().length, 1);
});

test('the composer\'s own send is not subscribed to', async () => {
  const { hook, subscribes, poll } = await renderIdleChatView();

  act(() => hook.result.current.markRunStartedHere('session-a'));
  await poll(busy, 1);

  assert.equal(subscribes().length, 1);
});

test('a refused send lets the run it collided with be subscribed to', async () => {
  const { hook, dispatch, subscribes, poll } = await renderIdleChatView();

  // The composer still thought the session idle while the server had just
  // sent the queued message.
  act(() => hook.result.current.markRunStartedHere('session-a'));
  await poll(busy);
  dispatch({ kind: 'protocol_error', code: 'RUN_IN_PROGRESS', error: 'already has a run in progress' });
  await poll(idle);
  await poll(new Map(busy));

  assert.equal(subscribes().length, 2, 'the server-sent run still has to attach');
});

test('a refused send while this socket is attached does not subscribe again', async () => {
  const { hook, dispatch, subscribes, poll } = await renderChatView();

  dispatch({ kind: 'chat_subscribed', isProcessing: true, runId: 'run-2', pendingPermissions: [] });
  await poll(busy);
  dispatch({ kind: 'text', role: 'user', content: 'q2', id: 'local_server_1', seq: 1, runId: 'run-2' });
  const before = subscribes().length;

  // The composer sends anyway, and the server refuses it.
  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'protocol_error', code: 'RUN_IN_PROGRESS', error: 'already has a run in progress' });
  // The spinner goes off with the refusal; the next poll puts it back.
  await poll(idle);
  await poll(new Map(busy));

  assert.equal(subscribes().length, before);
});

test('a turn that ended with background work does not leave its session watched', async () => {
  const { hook, dispatch, subscribes, poll } = await renderIdleChatView();

  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'text', role: 'assistant', content: 'started a background task', seq: 3, runId: 'run-1' });
  dispatch({ kind: 'complete', seq: 4, runId: 'run-1', exitCode: 0, success: true });
  await poll(background);
  // The task reports through the finished run: sequenced, and no second `complete`.
  dispatch({ kind: 'text', role: 'assistant', content: 'background finished', seq: 5, runId: 'run-1' });
  dispatch({ kind: 'status', text: 'token_budget', seq: 6, runId: 'run-1' });
  await poll(idle);
  const before = subscribes().length;

  // The dispatcher now sends the queued message.
  await poll(busy);

  assert.equal(subscribes().length, before + 1);
  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 6, runId: 'run-1' }]);
});

test('frames that trail an aborted run do not leave its session watched', async () => {
  const { hook, dispatch, subscribes, poll } = await renderIdleChatView();

  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'complete', seq: 2, runId: 'run-1', exitCode: 1, aborted: true });
  dispatch({ kind: 'text', role: 'assistant', content: 'partial', seq: 3, runId: 'run-1' });
  await poll(idle);
  const before = subscribes().length;

  await poll(busy);

  assert.equal(subscribes().length, before + 1);
});

test('a reconnect forgets what the dropped socket was attached to and resubscribes from its position', async () => {
  const { hook, dispatch, subscribes, poll, watchedRunSessionsRef } = await renderChatView();

  dispatch({ kind: 'chat_subscribed', isProcessing: true, runId: 'run-1', pendingPermissions: [] });
  dispatch({ kind: 'text', role: 'assistant', content: 'hi', seq: 4, runId: 'run-1' });
  watchedRunSessionsRef.current.set('session-b', 'attached');
  await poll(busy);
  const before = subscribes().length;

  await act(async () => {
    await hook.result.current.resubscribeAfterReconnect();
  });

  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 4, runId: 'run-1' }]);
  assert.equal(subscribes().length, before + 1);
  assert.equal(watchedRunSessionsRef.current.has('session-b'), false, 'that socket is gone');

  // The resubscribe is in flight; the poll does not send a second one.
  await poll(new Map(busy));
  assert.equal(subscribes().length, before + 1);
});

test('events a second subscribe replays are not shown twice; a new run\'s are', async () => {
  const { dispatch, appended, lastSeqRef } = await renderChatView();

  dispatch({ kind: 'text', role: 'user', content: 'q2', id: 'u1', seq: 1, runId: 'run-2' });
  dispatch({ kind: 'text', role: 'assistant', content: 'a2', id: 'a1', seq: 2, runId: 'run-2' });
  // Two subscribes overlapped: the run is replayed from its start again.
  dispatch({ kind: 'text', role: 'user', content: 'q2', id: 'u1', seq: 1, runId: 'run-2' });
  dispatch({ kind: 'text', role: 'assistant', content: 'a2', id: 'a1', seq: 2, runId: 'run-2' });
  assert.deepEqual(appended.map((message) => message.content), ['q2', 'a2']);

  // The next run starts again at seq 1.
  dispatch({ kind: 'text', role: 'user', content: 'q3', id: 'u2', seq: 1, runId: 'run-3' });
  assert.deepEqual(appended.map((message) => message.content), ['q2', 'a2', 'q3']);
  assert.deepEqual(lastSeqRef.current.get('session-a'), { runId: 'run-3', seq: 1 });
});

test('an idle ack older than this tab\'s own send keeps that send watched', async () => {
  // The send started at 200, after the subscribe that this ack answers.
  const { hook, dispatch, subscribes, poll } = await renderChatView({
    getSessionActivity: () => ({ statusText: null, canInterrupt: true, startedAt: Number.MAX_SAFE_INTEGER }),
  });

  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });
  await poll(busy);

  assert.equal(subscribes().length, 1);
});

test('an idle ack that missed a server-sent run leaves that run to be subscribed to', async () => {
  // No send from this tab; the server sent a queued message while the
  // subscribe from opening the session was still in flight.
  const { dispatch, subscribes, poll, watchedRunSessionsRef } = await renderChatView({
    getSessionActivity: () => ({ statusText: null, canInterrupt: true, startedAt: Number.MAX_SAFE_INTEGER }),
  });
  await poll(busy);
  assert.equal(subscribes().length, 1, 'the subscribe in flight covers the poll');

  // The ack answers that earlier subscribe. The poll that follows reports the
  // same busy state, so nothing else would subscribe.
  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });
  await poll(new Map(busy));
  assert.equal(subscribes().length, 2, 'the server-sent run still has to attach');
  assert.equal(watchedRunSessionsRef.current.get('session-a'), 'subscribe');

  // With a server clock ahead of this one, the next idle ack looks stale too;
  // the same run is not subscribed to over and over.
  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });
  assert.equal(subscribes().length, 2);
});

test('a reconnect during this tab\'s own run resumes after what it already showed', async () => {
  const { hook, dispatch, subscribes } = await renderIdleChatView();

  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'text', role: 'assistant', content: 'b1', id: 'b1', seq: 1, runId: 'run-B' });
  dispatch({ kind: 'text', role: 'assistant', content: 'b2', id: 'b2', seq: 2, runId: 'run-B' });
  await act(async () => {
    await hook.result.current.resubscribeAfterReconnect();
  });

  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 2, runId: 'run-B' }]);
});

test('a late frame of the run a send replaced does not make a reconnect replay the new run twice', async () => {
  const { hook, dispatch, subscribes, appended, lastSeqRef } = await renderIdleChatView();

  // Run A ended with background work; this tab's send starts run B, which
  // replaces A's process. A reports the killed task after B's first frame.
  dispatch({ kind: 'complete', seq: 11, runId: 'run-A', exitCode: 0 });
  act(() => hook.result.current.markRunStartedHere('session-a'));
  dispatch({ kind: 'text', role: 'assistant', content: 'b1', id: 'b1', seq: 1, runId: 'run-B' });
  dispatch({ kind: 'task_status', event: 'updated', id: 'a-tail', seq: 12, runId: 'run-A' });
  assert.deepEqual(lastSeqRef.current.get('session-a'), { runId: 'run-B', seq: 1 });

  // The socket drops and comes back.
  await act(async () => {
    await hook.result.current.resubscribeAfterReconnect();
  });
  assert.deepEqual(subscribes().at(-1)?.sessions, [{ sessionId: 'session-a', lastSeq: 1, runId: 'run-B' }]);

  // Even a server that replays run B from its start shows b1 once.
  dispatch({ kind: 'chat_subscribed', isProcessing: true, runId: 'run-B', pendingPermissions: [] });
  dispatch({ kind: 'text', role: 'assistant', content: 'b1', id: 'b1', seq: 1, runId: 'run-B' });
  assert.equal(appended.filter((message) => message.id === 'b1').length, 1);
});

test('an ack naming a newer run keeps the previous run\'s late frames off the position', async () => {
  const { dispatch, lastSeqRef } = await renderChatView({
    lastSeq: new Map([['session-a', { runId: 'run-A', seq: 5 }]]),
  });

  // The session moved on to run B while this socket was not attached.
  dispatch({ kind: 'chat_subscribed', isProcessing: true, runId: 'run-B', pendingPermissions: [] });
  dispatch({ kind: 'task_status', event: 'updated', id: 'a-tail', seq: 6, runId: 'run-A' });

  assert.deepEqual(lastSeqRef.current.get('session-a'), { runId: 'run-B', seq: 0 });
});

test('an idle ack newer than the busy state it contradicts does not subscribe again', async () => {
  // The session looked busy since before the subscribe went out; the server
  // has since answered that nothing is running.
  const { dispatch, subscribes, poll } = await renderChatView({
    getSessionActivity: () => ({ statusText: null, canInterrupt: true, startedAt: 1 }),
  });
  await poll(busy);

  dispatch({ kind: 'chat_subscribed', isProcessing: false, pendingPermissions: [] });

  assert.equal(subscribes().length, 1);
});
