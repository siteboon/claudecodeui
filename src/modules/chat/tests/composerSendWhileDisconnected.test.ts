import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { ChatMessage, PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * A send on a closed chat socket used to be dropped by the socket layer with a
 * console warning only, while the composer went on as if it had been sent: the
 * message was drawn as sent, the session was marked processing, and the
 * composer was cleared. On a phone, where a backgrounded tab loses its socket
 * within a minute, the prompt was simply gone ("it thinks for a second and
 * then stops"). The composer now refuses the send visibly and keeps the draft.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

type SubmitOptions = {
  session: ProjectSession | null;
  isConnected: boolean;
  /** What the socket layer reports for the frame: false when it could not send. */
  delivered: boolean;
};

const submit = async ({ session, isConnected, delivered }: SubmitOptions) => {
  const frames: Array<{ type: string }> = [];
  const added: ChatMessage[] = [];
  const onSessionProcessing = vi.fn();
  const onSessionEstablished = vi.fn();
  const view = renderHook(() =>
    useChatComposerState({
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
      isConnected,
      sendMessage: (message) => {
        frames.push(message as { type: string });
        return delivered;
      },
      onSessionProcessing,
      onSessionEstablished,
      scrollToBottom: () => undefined,
      addMessage: (message) => { added.push(message); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });
  return {
    view,
    sends: frames.filter((frame) => frame.type === 'chat.send'),
    userBubbles: added.filter((message) => message.type === 'user'),
    errors: added.filter((message) => message.type === 'error'),
    onSessionProcessing,
    onSessionEstablished,
  };
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/providers/sessions')) {
    return new Response(JSON.stringify({ data: { sessionId: 'new-session' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const sessionCreations = () => fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/providers/sessions'));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('while disconnected, a send is refused visibly and the draft stays in the composer', async () => {
  const result = await submit({ session: SESSION, isConnected: false, delivered: false });

  assert.equal(result.sends.length, 0, 'nothing is handed to the dead socket');
  assert.equal(result.userBubbles.length, 0, 'the message is not drawn as sent');
  assert.equal(result.onSessionProcessing.mock.calls.length, 0, 'the session is not marked as thinking');
  assert.equal(result.view.result.current.input, 'hello', 'the text stays in the composer');
  assert.equal(result.errors.length, 1, 'the user is told why');
  assert.match(String(result.errors[0]?.content), /not connected/i);
});

test('while disconnected, a new chat does not allocate a session it cannot use', async () => {
  const result = await submit({ session: null, isConnected: false, delivered: false });

  assert.equal(sessionCreations().length, 0, 'no empty session is created on the server');
  assert.equal(result.onSessionEstablished.mock.calls.length, 0);
  assert.equal(result.view.result.current.input, 'hello');
  assert.equal(result.errors.length, 1);
});

test('a socket that closes between the check and the send still keeps the message', async () => {
  const result = await submit({ session: SESSION, isConnected: true, delivered: false });

  assert.equal(result.sends.length, 1, 'the send was attempted');
  assert.equal(result.userBubbles.length, 0, 'but not drawn as sent');
  assert.equal(result.onSessionProcessing.mock.calls.length, 0);
  assert.equal(result.view.result.current.input, 'hello');
  assert.equal(readDraftText(SESSION.id as string), 'hello', 'the saved draft is not wiped either');
  assert.equal(result.errors.length, 1);
});

test('a new chat whose socket closes after the session was allocated carries the draft into that session', async () => {
  const result = await submit({ session: null, isConnected: true, delivered: false });

  assert.equal(sessionCreations().length, 1);
  assert.equal(result.onSessionEstablished.mock.calls[0]?.[0], 'new-session');
  assert.equal(result.userBubbles.length, 0);
  // The composer is about to switch to the new session and show its draft.
  assert.equal(readDraftText('new-session'), 'hello');
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), '');
  assert.equal(result.errors.length, 1);
});

test('when connected, a send goes out and clears the composer as before', async () => {
  const result = await submit({ session: SESSION, isConnected: true, delivered: true });

  assert.equal(result.sends.length, 1);
  assert.equal(result.userBubbles.length, 1);
  assert.equal(result.onSessionProcessing.mock.calls.length, 1);
  assert.equal(result.view.result.current.input, '');
  assert.equal(result.errors.length, 0);
});
