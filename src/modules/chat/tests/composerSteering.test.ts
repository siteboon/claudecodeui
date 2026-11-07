import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Steering: while a turn runs, the send menu's Steer row sends the message
 * into that turn (`chat.steer`) instead of queueing it until the turn ends.
 * The composer sends it, shows it as a card until the agent reads it, and
 * handles the two ways it can fail to land: the turn had already ended
 * (refused → queued as the next turn) and the run stopped before the agent
 * read it (→ back into the composer).
 */

type StoredQueued = { content: string; options?: Record<string, unknown>; attachments: unknown[] };

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let queued: Map<string, StoredQueued>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

// The upload and queue endpoints, as the server implements them.
const fakeServer = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(url);
  const method = init?.method ?? 'GET';
  const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};

  if (path.includes('/api/assets/files')) {
    const form = init?.body instanceof FormData ? init.body : new FormData();
    const files = form.getAll('files') as File[];
    return json({ attachments: files.map((file) => ({ name: file.name, path: `/uploads/${file.name}` })) });
  }
  if (path.endsWith('/api/user/drafts/queued-message') && method === 'POST') {
    const message = body.queuedMessage as StoredQueued;
    const queuedMessage = { content: message.content, options: message.options, attachments: message.attachments ?? [] };
    queued.set(String(body.scope), queuedMessage);
    return json({ success: true, queuedMessage, appended: false });
  }
  if (path.endsWith('/api/user/drafts') && method === 'GET') {
    return json({ success: true, drafts: [] });
  }
  return json([]);
};

type Props = { isLoading: boolean; supportsSteering: boolean };

const render = (initialProps: Partial<Props> = {}) => {
  const sent: Array<Record<string, unknown>> = [];
  const view = renderHook(
    ({ isLoading, supportsSteering }: Props) => useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id ?? null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'model-1',
      currentProviderEffort: 'medium',
      isLoading,
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as Record<string, unknown>); },
      supportsSteering,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
    { initialProps: { isLoading: true, supportsSteering: true, ...initialProps } },
  );
  return { view, sent };
};

type View = ReturnType<typeof render>['view'];

/** Types the message and chooses Steer from the send menu. */
const steer = async (view: View, text: string, files: File[] = []) => {
  await act(async () => {
    view.result.current.setInput(text);
    view.result.current.setAttachedFiles(files);
  });
  await act(async () => {
    await view.result.current.handleSendMenuChoice('steer');
  });
};

/** Types the message and presses Enter. */
const submit = async (view: View, text: string) => {
  await act(async () => {
    view.result.current.setInput(text);
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

const steerFrames = (sent: Array<Record<string, unknown>>) => sent.filter((frame) => frame.type === 'chat.steer');

beforeEach(async () => {
  queued = new Map();
  resetChatDrafts();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(fakeServer));
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
  localStorage.clear();
});

test('Steer from the send menu sends the message into the running turn', async () => {
  const { view, sent } = render();

  await steer(view, 'use the other file', [new File(['x'], 'notes.txt', { type: 'text/plain' })]);

  const frames = steerFrames(sent);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].sessionId, 'session-1');
  assert.equal(frames[0].content, 'use the other file');
  assert.match(String(frames[0].messageId), UUID_PATTERN, 'the id becomes its transcript uuid');
  assert.deepEqual((frames[0].options as Record<string, unknown>).attachments, [{ name: 'notes.txt', path: '/uploads/notes.txt' }]);

  assert.equal(view.result.current.input, '', 'it leaves the composer like a sent message');
  assert.equal(view.result.current.attachedFiles.length, 0);
  assert.equal(queued.size, 0, 'nothing is queued');
  assert.equal(view.result.current.queuedDraft, null);
  assert.deepEqual(view.result.current.pendingSteers.map((steer) => [steer.content, steer.status]), [['use the other file', 'sending']]);
});

test('the card follows the message: accepted, then gone once the agent reads it', async () => {
  const { view, sent } = render();
  await steer(view, 'change course');
  const messageId = String(steerFrames(sent)[0].messageId);

  act(() => view.result.current.handleSteerOutcome('session-1', messageId, 'accepted'));
  assert.equal(view.result.current.pendingSteers[0]?.status, 'accepted');

  // Another user message (some other id) is not this one.
  act(() => view.result.current.handleSteerOutcome('session-1', 'some-other-id', 'delivered'));
  assert.equal(view.result.current.pendingSteers.length, 1);

  act(() => view.result.current.handleSteerOutcome('session-1', messageId, 'delivered'));
  assert.deepEqual(view.result.current.pendingSteers, []);
});

test('a message with images is recognised by the parts its echo is split into', async () => {
  const { view, sent } = render();
  await steer(view, 'look at this');
  const messageId = String(steerFrames(sent)[0].messageId);

  act(() => view.result.current.handleSteerOutcome('session-1', `${messageId}_text_0`, 'delivered'));
  assert.deepEqual(view.result.current.pendingSteers, []);
});

test('a steer refused because the turn had ended is queued as the next turn, leaving what was typed since', async () => {
  const { view, sent } = render();
  await steer(view, 'one more thing');
  const messageId = String(steerFrames(sent)[0].messageId);
  await act(async () => { view.result.current.setInput('half-typed'); });

  await act(async () => {
    view.result.current.handleSteerOutcome('session-1', messageId, 'refused');
  });
  await vi.waitFor(() => assert.equal(queued.get('session-1')?.content, 'one more thing'));

  assert.deepEqual(view.result.current.pendingSteers, []);
  assert.equal(view.result.current.queuedDraft?.content, 'one more thing');
  assert.equal(view.result.current.input, 'half-typed', 'the composer is not touched');
});

test('a run that ends with an accepted message unread puts it back in the composer', async () => {
  const { view, sent } = render();
  await steer(view, 'stop after this file');
  const messageId = String(steerFrames(sent)[0].messageId);
  act(() => view.result.current.handleSteerOutcome('session-1', messageId, 'accepted'));
  await act(async () => { view.result.current.setInput('typed since'); });

  // The user pressed stop before the agent reached a tool call.
  view.rerender({ isLoading: false, supportsSteering: true });

  assert.deepEqual(view.result.current.pendingSteers, []);
  assert.equal(view.result.current.input, 'stop after this file\n\ntyped since');
  assert.equal(queued.size, 0, 'not sent behind the user\'s back after a stop');
});

test('a message the agent read before the run ended is not restored', async () => {
  const { view, sent } = render();
  await steer(view, 'noted');
  const messageId = String(steerFrames(sent)[0].messageId);
  act(() => view.result.current.handleSteerOutcome('session-1', messageId, 'accepted'));
  act(() => view.result.current.handleSteerOutcome('session-1', messageId, 'delivered'));

  view.rerender({ isLoading: false, supportsSteering: true });

  assert.equal(view.result.current.input, '');
});

test('Enter during a turn still queues, as before', async () => {
  const { view, sent } = render();
  await submit(view, 'after this');

  assert.equal(steerFrames(sent).length, 0);
  assert.equal(queued.get('session-1')?.content, 'after this');
});

test('a provider that cannot steer queues even when Steer is asked for', async () => {
  const { view, sent } = render({ supportsSteering: false });
  await steer(view, 'after this');

  assert.equal(steerFrames(sent).length, 0);
  assert.equal(queued.get('session-1')?.content, 'after this');
});

test('a slash command is a turn of its own, so Steer queues it', async () => {
  const { view, sent } = render();
  await steer(view, '/compact');

  assert.equal(steerFrames(sent).length, 0);
  assert.equal(queued.get('session-1')?.content, '/compact');
});

test('Steer chosen just as the turn ended sends the message as the next turn', async () => {
  const { view, sent } = render({ isLoading: false });
  await steer(view, 'hello');

  assert.equal(steerFrames(sent).length, 0);
  assert.equal(sent.filter((frame) => frame.type === 'chat.send').length, 1);
});
