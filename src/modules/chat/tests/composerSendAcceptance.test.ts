import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, readQueuedMessage, resetChatDrafts, writeDraftText } from '@/shared/chatDrafts';
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

type Frame = {
  type: string;
  sessionId: string;
  content: string;
  clientRequestId?: string;
  options: { attachments: unknown[] };
};

/**
 * What the fake socket does with the next `chat.send`: lose it, admit and
 * acknowledge it, admit it but lose the acknowledgement, or refuse it.
 */
type Delivery = 'swallow' | 'ack' | 'admit' | 'reject';

let delivery: Delivery = 'swallow';
let discardOutcome: 'discarded' | 'kept' | 'error' = 'discarded';
let frames: Frame[] = [];
let admittedRequestIds = new Set<string>();
const listeners = new Set<(event: ServerEvent) => void>();

const subscribe = (listener: (event: ServerEvent) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const emit = (event: ServerEvent) => {
  for (const listener of [...listeners]) listener(event);
};

const deliverLater = (event: ServerEvent) => {
  // A server frame always arrives in a later task than the send that caused it.
  queueMicrotask(() => emit(event));
};

/** The acknowledgement the server sends for `frame`, delivered whenever a test decides. */
const acknowledge = (frame: Frame | undefined) => {
  assert.ok(frame);
  emit({ kind: 'chat_send_accepted', sessionId: frame.sessionId, clientRequestId: frame.clientRequestId });
};

const sendMessage = (message: unknown) => {
  const frame = message as Frame;
  if (frame.type !== 'chat.send' && frame.type !== 'chat.edit-send') return;
  frames.push(frame);
  const requestId = frame.clientRequestId ?? '';
  // Like the server: a request it already admitted is acknowledged again, as
  // a duplicate, rather than run a second time.
  const duplicate = admittedRequestIds.has(requestId);
  if (delivery === 'ack' || delivery === 'admit') {
    admittedRequestIds.add(requestId);
  }
  if (delivery === 'ack') {
    deliverLater({
      kind: 'chat_send_accepted',
      sessionId: frame.sessionId,
      clientRequestId: frame.clientRequestId,
      ...(duplicate ? { duplicate: true } : {}),
    });
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
  const unsentSessionId = /\/api\/providers\/sessions\/([^/?]+)\/unsent/.exec(url)?.[1];
  if (unsentSessionId && init?.method === 'DELETE') {
    // Answers `kept` for every session but the new one, as the server does for
    // a session with history. The server would delete an existing row with no
    // transcript, no provider id and no admitted turn, which is why the composer
    // must never ask about an existing session (tests assert no DELETE at all).
    const outcome = unsentSessionId === NEW_SESSION_ID ? discardOutcome : 'kept';
    return outcome === 'error'
      ? json({ success: false, error: 'Database is locked' }, 500)
      : json({ success: true, data: { sessionId: unsentSessionId, outcome } });
  }
  if (url.endsWith('/api/assets/files') && init?.method === 'POST') {
    return json({ attachments: [{ name: 'screenshot.png', path: '/uploads/screenshot.png', mimeType: 'image/png' }] });
  }
  return json([]);
});

const callsTo = (fragment: string, method: string) => fetchMock.mock.calls.filter(
  ([input, init]) => String(input).includes(fragment) && init?.method === method,
);

/** Every DELETE the composer made, whatever it was for. */
const deleteRequests = () => fetchMock.mock.calls
  .filter(([, init]) => init?.method === 'DELETE')
  .map(([input]) => String(input));

/** What a test can change between renders: the open chat and whether it is running a turn. */
type ComposerProps = { session: ProjectSession | null; isLoading?: boolean };

const renderComposer = (selectedSession: ProjectSession | null) => {
  const established: string[] = [];
  const processing: Array<string | null | undefined> = [];
  const added: ChatMessage[] = [];
  const initialProps: ComposerProps = { session: selectedSession };
  const view = renderHook(({ session, isLoading = false }: ComposerProps) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading,
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
  }), { initialProps });
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
  admittedRequestIds = new Set();
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

test('a message to an open chat that never reaches the server keeps the draft and deletes nothing', async () => {
  const { view, processing, added } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  // Only a session made for this very message may be given up. Asking the
  // server about an existing one would also answer `kept` — it has a
  // conversation — and pass the lost message off as sent.
  assert.deepEqual(deleteRequests(), [], 'the conversation is not offered up for deletion');
  assert.equal(view.result.current.input, 'hello', 'the message is still in the composer');
  assert.equal(readDraftText(SESSION.id), 'hello', 'and in its saved draft');
  assert.match(view.result.current.sendError ?? '', /not confirm/i);
  assert.deepEqual(processing, []);
  assert.equal(added.some((message) => message.type === 'user'), false);
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

test('text typed while a message waits for its acknowledgement is kept when the message goes out', async () => {
  discardOutcome = 'kept';
  const { view, established, added } = renderComposer(null);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  // Nothing looks sent yet, so the user goes on typing.
  await typeMessage(view, 'hello -- and also please check the tests');
  await settle(pending, ACCEPTANCE_TIMEOUT_MS);

  assert.deepEqual(established, [NEW_SESSION_ID], 'the message did go out');
  assert.deepEqual(added.filter((message) => message.type === 'user').map((message) => message.content), ['hello']);
  assert.equal(
    readDraftText(NEW_SESSION_ID),
    'hello -- and also please check the tests',
    'what was typed since is the draft of the session the composer now opens',
  );
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), '', 'and is not left behind in the new-chat composer');

  // Opening the new session, as `onSessionEstablished` does, brings it back.
  await act(async () => { view.rerender({ session: { id: NEW_SESSION_ID } }); });
  assert.equal(view.result.current.input, 'hello -- and also please check the tests');
});

test('text typed into an open chat while its message waits for the acknowledgement is kept', async () => {
  delivery = 'admit';
  const { view } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  await typeMessage(view, 'hello -- and also please check the tests');
  acknowledge(frames[0]);
  await settle(pending);

  assert.equal(view.result.current.input, 'hello -- and also please check the tests');
  assert.equal(readDraftText(SESSION.id), 'hello -- and also please check the tests');
});

test('a file attached while a message waits for its acknowledgement stays attached', async () => {
  delivery = 'admit';
  const { view } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  const screenshot = new File(['png'], 'screenshot.png', { type: 'image/png' });
  await act(async () => { view.result.current.setAttachedFiles([screenshot]); });
  acknowledge(frames[0]);
  await settle(pending);

  assert.equal(view.result.current.input, '', 'the sent text is consumed');
  assert.deepEqual(view.result.current.attachedFiles, [screenshot], 'the file attached since is not');
});

test('retrying a message whose turn is already running sends it again instead of queueing a copy', async () => {
  // The turn was admitted, but its acknowledgement never came back.
  delivery = 'admit';
  const { view, processing, added } = renderComposer(SESSION);
  await typeMessage(view, 'hello');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);
  assert.match(view.result.current.sendError ?? '', /not confirm/i);

  // Its run shows the session as busy, which is when Enter would queue.
  await act(async () => { view.rerender({ session: SESSION, isLoading: true }); });
  delivery = 'ack';
  await settle(await startSubmit(view));

  assert.equal(frames.length, 2, 'sent again, not queued');
  assert.equal(frames[1]?.clientRequestId, frames[0]?.clientRequestId, 'as the same turn, so the server does not run it twice');
  assert.equal(readQueuedMessage(SESSION.id), null, 'no copy is left to run after it');
  assert.equal(view.result.current.input, '');
  assert.equal(view.result.current.sendError, null);
  assert.equal(added.filter((message) => message.type === 'user').length, 1);
  // The run was started by the first attempt and reports its own progress;
  // the composer marking it again would leave a finished run spinning.
  assert.deepEqual(processing, []);
});

test('a retry refused because another turn is running is queued by the next send', async () => {
  const { view } = renderComposer(SESSION);
  await typeMessage(view, 'hello');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  await act(async () => { view.rerender({ session: SESSION, isLoading: true }); });
  delivery = 'reject';
  await settle(await startSubmit(view));
  assert.match(view.result.current.sendError ?? '', /already has a run in progress/);
  assert.equal(view.result.current.input, 'hello');

  // Refused means never admitted: the message now waits its turn like any other.
  await act(async () => { await view.result.current.handleSubmit(submitEvent); });

  assert.equal(frames.length, 2);
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'hello');
  assert.equal(view.result.current.input, '');
  assert.equal(view.result.current.sendError, null, 'the notice about the refused attempt is gone');
});

test('a reconnect while a message waits gives up on its acknowledgement at once', async () => {
  delivery = 'admit';
  const { view } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  // The acknowledgement would have gone to the socket that was replaced.
  await act(async () => {
    emit({ kind: 'websocket_reconnected' });
    await vi.advanceTimersByTimeAsync(1_000);
  });

  assert.match(view.result.current.sendError ?? '', /not confirm/i, 'reported well before the timeout');
  assert.equal(view.result.current.input, 'hello');
  await settle(pending, ACCEPTANCE_TIMEOUT_MS);
});

test('a retry after the empty session could not be discarded reuses that session', async () => {
  discardOutcome = 'error';
  const { view, established } = renderComposer(null);
  await typeMessage(view, 'hello');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  delivery = 'ack';
  await settle(await startSubmit(view));

  assert.equal(callsTo('/api/providers/sessions', 'POST').length, 1, 'no second session is allocated');
  assert.equal(frames[1]?.sessionId, NEW_SESSION_ID);
  assert.equal(frames[1]?.clientRequestId, frames[0]?.clientRequestId);
  assert.deepEqual(established, [NEW_SESSION_ID]);
});

test('a retry after the empty session was discarded starts over as a new turn', async () => {
  const { view } = renderComposer(null);
  await typeMessage(view, 'hello');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  delivery = 'ack';
  await settle(await startSubmit(view));

  assert.equal(callsTo('/api/providers/sessions', 'POST').length, 2, 'the deleted session is not reused');
  assert.notEqual(frames[1]?.clientRequestId, frames[0]?.clientRequestId);
});

test('retrying a message with a file does not upload the file again', async () => {
  const { view } = renderComposer(SESSION);
  const screenshot = new File(['png'], 'screenshot.png', { type: 'image/png' });
  await act(async () => { view.result.current.setAttachedFiles([screenshot]); });
  await typeMessage(view, 'look');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  delivery = 'ack';
  await settle(await startSubmit(view));

  assert.equal(callsTo('/api/assets/files', 'POST').length, 1);
  assert.deepEqual(frames[1]?.options.attachments, frames[0]?.options.attachments);
  assert.deepEqual(view.result.current.attachedFiles, []);
});

test('a send shows as pending until the server answers, and its notice can be dismissed', async () => {
  const { view } = renderComposer(SESSION);
  await typeMessage(view, 'hello');

  const pending = await startSubmit(view);
  assert.equal(view.result.current.isSendPending, true, 'the composer does not look idle while it waits');
  await settle(pending, ACCEPTANCE_TIMEOUT_MS);
  assert.equal(view.result.current.isSendPending, false);
  assert.ok(view.result.current.sendError);

  await act(async () => { view.result.current.dismissSendError(); });
  assert.equal(view.result.current.sendError, null);
  assert.equal(view.result.current.input, 'hello', 'the draft the notice was about stays');
});

test('an acknowledgement that comes in after its send gave up does not confirm the next message', async () => {
  // The first attempt was admitted, but its acknowledgement is late.
  delivery = 'admit';
  const { view, processing, added } = renderComposer(SESSION);
  await typeMessage(view, 'hello');
  await settle(await startSubmit(view), ACCEPTANCE_TIMEOUT_MS);

  // The user rewrites the message and sends that instead: a different turn.
  await typeMessage(view, 'hello, said differently');
  const second = await startSubmit(view);
  assert.notEqual(frames[1]?.clientRequestId, frames[0]?.clientRequestId);

  await act(async () => {
    acknowledge(frames[0]);
    await vi.advanceTimersByTimeAsync(1_000);
  });

  assert.equal(view.result.current.isSendPending, true, 'the second message still waits for its own answer');
  assert.equal(view.result.current.input, 'hello, said differently');
  assert.deepEqual(processing, []);
  assert.equal(added.some((message) => message.type === 'user'), false);

  acknowledge(frames[1]);
  await settle(second);
  assert.equal(view.result.current.input, '');
  assert.deepEqual(added.filter((message) => message.type === 'user').map((message) => message.content), [
    'hello, said differently',
  ]);
});

test('a send stops listening for its acknowledgement once it is answered or gives up', async () => {
  const { view } = renderComposer(SESSION);
  assert.equal(listeners.size, 0, 'nothing listens before a message is sent');

  const answers = [
    { answer: 'ack', advanceMs: 0 },
    { answer: 'reject', advanceMs: 0 },
    { answer: 'swallow', advanceMs: ACCEPTANCE_TIMEOUT_MS },
  ] as const;
  for (const { answer, advanceMs } of answers) {
    delivery = answer;
    await typeMessage(view, `message answered with ${answer}`);
    await settle(await startSubmit(view), advanceMs);
    assert.equal(listeners.size, 0, `no listener is left behind after "${answer}"`);
  }
  assert.equal(frames.length, answers.length);
});
