import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * The send button becomes the stop button as soon as the turn starts, in the
 * same spot. The second half of a double tap therefore stopped the turn before
 * it had produced anything, leaving a user message in the transcript that never
 * ran. Stops inside the grace window after a send are dropped.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};
const SESSION = { id: 'session-1' } as ProjectSession;

type SentFrame = { type: string; sessionId?: string; content?: string };

let sent: SentFrame[] = [];
let now = 1_000_000;
let boundSession = SESSION;

const renderComposer = () => {
  sent = [];
  boundSession = SESSION;
  return renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: boundSession,
      currentSessionId: boundSession.id,
      provider: 'claude',
      permissionMode: 'default' as PermissionMode,
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: false,
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as SentFrame); },
      onSessionEstablished: () => undefined,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
};

const sendMessage = async (view: ReturnType<typeof renderComposer>, text: string) => {
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

const abort = async (view: ReturnType<typeof renderComposer>) => {
  await act(async () => { view.result.current.handleAbortSession(); });
};

const openSession = async (view: ReturnType<typeof renderComposer>, session: ProjectSession) => {
  boundSession = session;
  await act(async () => { view.rerender(); });
};

beforeEach(() => {
  localStorage.clear();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

test('a stop arriving right after sending is dropped', async () => {
  const view = renderComposer();
  await sendMessage(view, 'hello');
  assert.equal(sent.filter((frame) => frame.type === 'chat.send').length, 1);

  now += 400;
  await abort(view);

  assert.equal(
    sent.filter((frame) => frame.type === 'chat.abort').length,
    0,
    'the tap that sent the message must not also stop it',
  );
});

test('a stop after the grace window still stops the turn', async () => {
  const view = renderComposer();
  await sendMessage(view, 'hello');

  now += 1000;
  await abort(view);

  assert.deepEqual(
    sent.filter((frame) => frame.type === 'chat.abort').map((frame) => frame.sessionId),
    [SESSION.id],
  );
});

test('a stop in a conversation nothing was just sent from is untouched', async () => {
  const view = renderComposer();
  await abort(view);

  assert.equal(sent.filter((frame) => frame.type === 'chat.abort').length, 1);
});

test('a send into another chat does not swallow the stop of the chat on screen', async () => {
  const other: ProjectSession = { id: 'session-2' } as ProjectSession;
  const view = renderComposer();

  // The upload that finishes after the user has already moved on still records
  // its own destination; the window must not follow the user to the new chat.
  await sendMessage(view, 'hello');
  await openSession(view, other);

  now += 400;
  await abort(view);

  assert.deepEqual(
    sent.filter((frame) => frame.type === 'chat.abort').map((frame) => frame.sessionId),
    [other.id],
  );
});