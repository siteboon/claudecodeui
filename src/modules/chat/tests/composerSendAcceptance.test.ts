import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts, writeDraftText } from '@/shared/chatDrafts';
import type { ChatMessage, PermissionMode, Project, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * `WebSocket.send()` only queues a frame: it returns before anything reaches
 * the server, and a frame can be lost while the socket still reports OPEN.
 * The composer used to treat that return as delivery, so a first message whose
 * `chat.send` never arrived was cleared from the input and its freshly created
 * session opened, leaving a titled conversation with nothing in it (#1452).
 *
 * The composer now tags each turn with a request id and only lets go of the
 * draft once the server acknowledges that id. These tests drive the real hook
 * against a fake socket whose frames either vanish or are acknowledged.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const NEW_SESSION_ID = 'new-session';
const ACCEPTANCE_TIMEOUT_MS = 10_000;

type Frame = { type: string; sessionId: string; content: string; clientRequestId?: string };

/** What the fake socket does with the next `chat.send`. */
type Delivery = 'swallow' | 'ack' | 'reject';

let delivery: Delivery = 'swallow';
let discardOutcome: 'discarded' | 'kept' = 'discarded';
let frames: Frame[] = [];
const listeners = new Set<(event: ServerEvent) => void>();

const subscribe = (listener: (event: ServerEvent) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const deliverLater = (event: ServerEvent) => {
  // A server frame always arrives in a later task than the send that caused it.
  queueMicrotask(() => {
    for (const listener of [...listeners]) listener(event);
  });
};

const sendMessage = (message: unknown) => {
  const frame = message as Frame;
  if (frame.type !== 'chat.send' && frame.type !== 'chat.edit-send') return;
  frames.push(frame);
  if (delivery === 'ack') {
    deliverLater({ kind: 'chat_send_accepted', sessionId: frame.sessionId, clientRequestId: frame.clientRequestId });
  } else if (delivery === 'reject') {
    deliverLater({
      kind: 'protocol_error',
      code: 'RUN_IN_PROGRESS',
      error: 'Session "session-1" already has a run in progress.',
      sessionId: frame.sessionId,
      clientRequestId: frame.clientRequestId,
    });
  }
};

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  if (url.endsWith('/api/providers/sessions') && init?.method === 'POST') {
    return json({ success: true, data: { sessionId: NEW_SESSION_ID, sessionName: 'hello' } }, 201);
  }
  if (url.includes(`/api/providers/sessions/${NEW_SESSION_ID}/unsent`) && init?.method === 'DELETE') {
    return json({ success: true, data: { sessionId: NEW_SESSION_ID, outcome: discardOutcome } });
  }
  return json([]);
});

const callsTo = (fragment: string, method: string) => fetchMock.mock.calls.filter(
  ([input, init]) => String(input).includes(fragment) && init?.method === method,
);

const renderComposer = (selectedSession: ProjectSession | null) => {
  const established: string[] = [];
  const processing: Array<string | null | undefined> = [];
  const added: ChatMessage[] = [];
  const view = renderHook(({ session }: { session: ProjectSession | null }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage,
    subscribe,
    onSessionEstablished: (sessionId) => { established.push(sessionId); },
    onSessionProcessing: (sessionId) => { processing.push(sessionId); },
    scrollToBottom: () => undefined,
    addMessage: (message) => { added.push(message); },
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }), { initialProps: { session: selectedSession } });
  return { view, established, processing, added };
};

const submitEvent = { preventDefault: () => undefined } as never;

/**
 * Starts a send and hands it back unsettled (boxed, so awaiting this does not
 * also await the send) once the frame is out. Session creation comes first,
 * so the acknowledgement clock only runs from then on.
 */
const startSubmit = async (view: ReturnType<typeof renderComposer>['view'], framesAfter = frames.length + 1) => {
  let pending: Promise<void> = Promise.resolve();
  await act(async () => { pending = view.result.current.handleSubmit(submitEvent); });
  await vi.waitFor(() => assert.equal(frames.length, framesAfter));
  return { pending };
};

const settle = async ({ pending }: { pending: Promise<void> }, advanceMs = 0) => {
  await act(async () => {
    if (advanceMs) await vi.advanceTimersByTimeAsync(advanceMs);
    await pending;
  });
};

const typeMessage = async (view: ReturnType<typeof renderComposer>['view'], text: string) => {
  await act(async () => { view.result.current.setInput(text); });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  delivery = 'swallow';
  discardOutcome = 'discarded';
  frames = [];
  listeners.clear();
  localStorage.clear();
  resetChatDrafts();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a first message whose frame never reaches the server keeps the draft and opens no session', async () => {
  const { view, established, processing, added } = renderComposer(null);
  await typeMessage(view, 'hello');

  const first = await startSubmit(view);
  // Pressing Enter again while it is unconfirmed must not send it twice.
  await settle(await startSubmit(view, 1));
  await settle(first, ACCEPTANCE_TIMEOUT_MS);

  assert.equal(frames.length, 1, 'the frame was handed to the socket once');
  assert.equal(callsTo('/api/providers/sessions', 'POST').length, 1, 'one session was allocated');
  assert.equal(view.result.current.input, 'hello', 'the message is still in the composer');
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), 'hello', 'and in its saved draft');
  assert.deepEqual(established, [], 'the new session is not opened');
  assert.deepEqual(processing, [], 'nothing is shown as running');
  assert.equal(added.some((message) => message.type === 'user'), false, 'no bubble claims it was sent');
  assert.match(view.result.current.sendError ?? '', /not confirm/i, 'a retryable error is shown');
  assert.equal(callsTo(`/api/providers/sessions/${NEW_SESSION_ID}/unsent`, 'DELETE').length, 1, 'the empty session is discarded');
});

test('an acknowledged first message clears the draft and opens the new session', async () => {
  delivery = 'ack';
  const { view, established, processing, added } = renderComposer(null);
  await typeMessage(view, 'hello');

  await settle(await startSubmit(view));

  assert.equal(typeof frames[0]?.clientRequestId, 'string', 'the turn is tagged so it can be acknowledged');
  assert.equal(view.result.current.input, '');
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), '');
  assert.deepEqual(established, [NEW_SESSION_ID]);
  assert.deepEqual(processing, [NEW_SESSION_ID]);
  assert.equal(added.filter((message) => message.type === 'user').length, 1);
  assert.equal(view.result.current.sendError, null);
  assert.equal(callsTo('/unsent', 'DELETE').length, 0);
});

test('a first message whose acknowledgement was lost is treated as sent once the server says it was admitted', async () => {
  discardOutcome = 'kept';
  const { view, established, added } = renderComposer(null);
  await typeMessage(view, 'hello');

  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  assert.equal(
    callsTo(`/api/providers/sessions/${NEW_SESSION_ID}/unsent`, 'DELETE').length,
    1,
    'the server is asked whether the turn arrived before the session is given up',
  );
  assert.deepEqual(established, [NEW_SESSION_ID]);
  assert.equal(view.result.current.input, '');
  assert.equal(added.filter((message) => message.type === 'user').length, 1);
  assert.equal(view.result.current.sendError, null);
});

test('retrying an unconfirmed message reuses its request id, so the server can tell it is the same turn', async () => {
  const { view, processing } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);
  assert.equal(view.result.current.input, 'hello');
  assert.deepEqual(processing, []);

  delivery = 'ack';
  await settle(await startSubmit(view));

  assert.equal(frames.length, 2);
  assert.equal(frames[1]?.clientRequestId, frames[0]?.clientRequestId);
  assert.equal(view.result.current.input, '');
  assert.equal(view.result.current.sendError, null);
  assert.deepEqual(processing, [SESSION.id]);
});

test('a message the server refuses keeps the draft and reports why at once', async () => {
  delivery = 'reject';
  const { view, processing } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  // No clock movement: the refusal settles the send, not the timeout.
  await settle(await startSubmit(view));

  assert.equal(view.result.current.input, 'hello');
  assert.deepEqual(processing, []);
  assert.match(view.result.current.sendError ?? '', /already has a run in progress/);
});

test('a send confirmed after the user opened another chat leaves that chat\'s draft alone', async () => {
  discardOutcome = 'kept';
  writeDraftText('session-b', 'draft for B');
  const { view, established } = renderComposer(null);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  // While the first message is still unconfirmed, the user opens session B.
  await act(async () => { view.rerender({ session: { id: 'session-b' } }); });
  await settle(pending, ACCEPTANCE_TIMEOUT_MS);

  assert.deepEqual(established, [NEW_SESSION_ID], 'the message did go out');
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), '', 'the draft it was sent from is consumed');
  assert.equal(readDraftText('session-b'), 'draft for B');
  assert.equal(view.result.current.input, 'draft for B');
});
