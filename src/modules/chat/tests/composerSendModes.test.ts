import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readQueuedMessage, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Three ways `handleSubmit` behaves while a turn is already running: `steer`
 * folds the draft into it via a `chat.steer` frame and leaves no durable
 * draft; `interrupt` aborts the turn and resends via `chat.send` with
 * `options.interrupt: true`; the default (no mode, the pre-existing
 * behaviour) sends nothing and stashes the text as a queued draft instead.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const submit = async (mode?: 'steer' | 'interrupt') => {
  const sent: Array<{ type: string; options?: Record<string, unknown> }> = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: true,
      processingSessions: undefined,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string; options?: Record<string, unknown> }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    await view.result.current.handleSubmit(
      { preventDefault: () => undefined } as never,
      undefined,
      mode ? { mode } : undefined,
    );
  });
  return { sent, view };
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  localStorage.clear();
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetChatDrafts();
});

test('steer mode sends one chat.steer frame and leaves no queued draft behind', async () => {
  const { sent } = await submit('steer');

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, 'chat.steer');
  assert.equal(sent.some((message) => message.type === 'chat.send'), false);
  assert.equal(readQueuedMessage(SESSION.id), null);
});

test('interrupt mode sends one chat.send frame with options.interrupt true', async () => {
  const { sent } = await submit('interrupt');

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, 'chat.send');
  assert.equal(sent[0]?.options?.interrupt, true);
});

test('plain submit with no mode queues instead of sending (negative control)', async () => {
  const { sent } = await submit();

  assert.equal(sent.length, 0);
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'hello');
});

test('steering a queued draft sends the queued text and leaves the live composer alone', async () => {
  const sent: Array<{ type: string; content?: string; options?: Record<string, unknown> }> = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: true,
      processingSessions: undefined,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string; content?: string; options?: Record<string, unknown> }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );

  // Queue a draft first (plain submit, no mode, while a turn is running).
  await act(async () => { view.result.current.setInput('queued text'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'queued text', 'sanity: the draft is queued');

  // The user starts typing something new in the live composer before the
  // queued draft is steered in.
  await act(async () => { view.result.current.setInput('typing now'); });

  act(() => { view.result.current.sendQueuedDraft('steer'); });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, 'chat.steer');
  assert.equal(sent[0]?.content, 'queued text', 'the steer fires for the queued draft, not the live composer');
  assert.equal(view.result.current.input, 'typing now', 'the live composer keeps what the user was typing');
});

test('a direct steer submit from the composer (no queued draft) clears the composer as before (negative control)', async () => {
  const { view } = await submit('steer');

  assert.equal(view.result.current.input, '', 'a steer sent from the live composer still clears it');
});

test('handleSteerRejected reports whether it actually consumed a pending steer', async () => {
  const { view } = await submit('steer');

  // The just-submitted steer is still pending for this session, so the first
  // rejection consumes it...
  let first: boolean | void = undefined;
  act(() => { first = view.result.current.handleSteerRejected(SESSION.id); });
  assert.equal(first, true, 'a pending steer for this session is consumed');
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'hello', 'the rejected steer text is re-queued, not lost');

  // ...and nothing is left pending for a second rejection (e.g. an ordinary
  // chat.send refused with the same code) to falsely swallow.
  let second: boolean | void = undefined;
  act(() => { second = view.result.current.handleSteerRejected(SESSION.id); });
  assert.equal(second, false, 'nothing pending, so the caller must not treat this as consumed');
});

/** Base hook config shared by the fallback-ack and negative-control tests below, which need their own spies. */
const baseConfig = (overrides: Record<string, unknown> = {}) => ({
  selectedProject: PROJECT,
  selectedSession: SESSION,
  currentSessionId: SESSION.id,
  provider: 'claude' as const,
  permissionMode: 'default' as PermissionMode,
  cyclePermissionMode: () => undefined,
  resolvePermissionModeForProvider: () => 'default' as PermissionMode,
  currentProviderModel: 'test-model',
  currentProviderEffort: 'medium',
  isLoading: false,
  processingSessions: undefined,
  canAbortSession: false,
  tokenBudget: null,
  sendMessage: () => undefined,
  scrollToBottom: () => undefined,
  addMessage: () => undefined,
  setIsUserScrolledUp: () => undefined,
  setPendingPermissionRequests: () => undefined,
  ...overrides,
});

test('handleSteerRejected with no pending steer returns false and leaves the queue null (negative control)', async () => {
  const view = renderHook(() => useChatComposerState(baseConfig() as never));

  let result: boolean | void = undefined;
  act(() => { result = view.result.current.handleSteerRejected(SESSION.id); });
  assert.equal(result, false, 'nothing was ever steered, so there is nothing to consume');
  assert.equal(readQueuedMessage(SESSION.id), null, 'the queue stays empty');
});

test('a fallback chat_steered ack marks the session processing and clears the pending steer, without a duplicate bubble', async () => {
  const addMessageCalls: unknown[] = [];
  const processingCalls: Array<[unknown, unknown]> = [];
  const view = renderHook(() => useChatComposerState(baseConfig({
    isLoading: true,
    addMessage: (message: unknown) => { addMessageCalls.push(message); },
    onSessionProcessing: (sessionId: unknown, activity: unknown) => { processingCalls.push([sessionId, activity]); },
  }) as never));

  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    await view.result.current.handleSubmit(
      { preventDefault: () => undefined } as never,
      undefined,
      { mode: 'steer' },
    );
  });

  act(() => { view.result.current.handleSteerAcked(SESSION.id, undefined, true); });

  assert.equal(processingCalls.length, 1, 'the fallback ack marks the session processing so Stop/spinner shows for the run the server actually started');
  assert.equal(processingCalls[0]?.[0], SESSION.id);

  // Deliberately NOT calling `addMessage` here: chat-websocket.service.ts's
  // `handleChatSteer` fallback branch already echoes the same message back on
  // the run stream (`steered: false`), which is what renders the bubble —
  // exactly like the real-fold case, which has never called `addMessage`
  // either (see the 'chat_steered' case in useChatRealtimeHandlers.ts).
  // Adding it here too would double the bubble in the running app.
  assert.equal(addMessageCalls.length, 0, 'no duplicate bubble — the server run-stream echo renders it');

  // The pending steer is gone either way: nothing left for a later rejection
  // to consume.
  let rejected: boolean | void = undefined;
  act(() => { rejected = view.result.current.handleSteerRejected(SESSION.id); });
  assert.equal(rejected, false, 'the acked steer is no longer pending');
});

test('handleSteerRejected merges into an already-queued message instead of overwriting it', async () => {
  const sent: Array<{ type: string; content?: string }> = [];
  const view = renderHook(() => useChatComposerState(baseConfig({
    isLoading: true,
    sendMessage: (message: unknown) => { sent.push(message as { type: string; content?: string }); },
  }) as never));

  // Queue 'first' (plain submit, no mode, while a turn is running).
  await act(async () => { view.result.current.setInput('first'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'first', 'sanity: first is queued');
  const firstOptions = readQueuedMessage(SESSION.id)?.options;

  // Steer 'second' — the pending steer that will be rejected below.
  await act(async () => { view.result.current.setInput('second'); });
  await act(async () => {
    await view.result.current.handleSubmit(
      { preventDefault: () => undefined } as never,
      undefined,
      { mode: 'steer' },
    );
  });
  assert.equal(
    sent.some((message) => message.type === 'chat.steer' && message.content === 'second'),
    true,
    'sanity: second was steered',
  );

  act(() => { view.result.current.handleSteerRejected(SESSION.id, 'STEER_UNSUPPORTED'); });

  const merged = readQueuedMessage(SESSION.id);
  assert.equal(
    merged?.content,
    'first\n\nsecond',
    'the rejected steer is appended to the already-queued message, not overwriting it',
  );
  assert.deepEqual(merged?.options, firstOptions, 'the merge keeps the earlier queued message\'s send options');
});

test('a provider without steer support (e.g. codex) queues a steer submit instead of sending chat.steer', async () => {
  const sent: Array<{ type: string }> = [];
  const view = renderHook(() => useChatComposerState(baseConfig({
    provider: 'codex',
    isLoading: true,
    sendMessage: (message: unknown) => { sent.push(message as { type: string }); },
  }) as never));

  assert.equal(view.result.current.canSteer, false, 'sanity: codex cannot steer');

  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    await view.result.current.handleSubmit(
      { preventDefault: () => undefined } as never,
      undefined,
      { mode: 'steer' },
    );
  });

  assert.equal(
    sent.some((message) => message.type === 'chat.steer'),
    false,
    'no chat.steer frame is sent for a provider that cannot steer',
  );
  assert.equal(readQueuedMessage(SESSION.id)?.content, 'hello', 'falls back to the ordinary queue instead');
});
