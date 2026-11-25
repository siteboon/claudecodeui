import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionEstablishedContext } from '@/shared/types';

/**
 * A new chat's session is created before the first send. When the user opens
 * another chat while that request runs, its answer must not take over the chat
 * they moved to (#1744).
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
type Props = { session: ProjectSession | null };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pendingCreates: Array<(response: Response) => void> = [];

const renderComposer = () => {
  const sent: Array<{ type: string; sessionId?: string }> = [];
  const added: unknown[] = [];
  const established: Array<[string, SessionEstablishedContext]> = [];
  let rerender: ((props: Props) => void) | undefined;
  const view = renderHook(({ session }: Props) =>
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
      supportsSteering: false,
      supportsSideQuestions: true,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      onSessionEstablished: (sessionId, context) => {
        established.push([sessionId, context]);
        if (!context.chatLeft) rerender?.({ session: { id: sessionId } });
      },
      scrollToBottom: () => undefined,
      addMessage: (message) => { added.push(message); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: null as ProjectSession | null } });
  rerender = view.rerender;
  return { view, sent, added, established };
};

const answerCreate = async (response: Response) => {
  await act(async () => {
    for (const resolve of pendingCreates.splice(0)) resolve(response);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  pendingCreates = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingCreates.push(resolve); });
    }
    return Promise.resolve(jsonResponse([]));
  }));
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
});

const sendThenLeave = async (composer: ReturnType<typeof renderComposer>) => {
  await act(async () => { composer.view.result.current.setInput('first message'); });
  await act(async () => {
    void composer.view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  assert.equal(pendingCreates.length, 1, 'the send waits for the new session');
  await act(async () => { composer.view.rerender({ session: { id: 'session-other' } }); });
};

test('a new chat answered after the user left still sends, but leaves the open chat alone', async () => {
  const composer = renderComposer();
  await sendThenLeave(composer);
  await answerCreate(jsonResponse({ success: true, data: { sessionId: 'session-new' } }, 201));

  assert.deepEqual(composer.sent.map((message) => [message.type, message.sessionId]), [['chat.send', 'session-new']]);
  assert.deepEqual(composer.established.map(([id, context]) => [id, context.chatLeft]), [['session-new', true]]);
  assert.deepEqual(composer.added, [], 'no message lands in the open chat');
});

test('a failed session creation after the user left reports nothing into the open chat', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const composer = renderComposer();
  await sendThenLeave(composer);
  await answerCreate(jsonResponse({ success: false }, 500));

  assert.deepEqual(composer.sent, []);
  assert.deepEqual(composer.added, []);
});

test('a new chat the user stayed in is still selected and shows the message', async () => {
  const composer = renderComposer();
  await act(async () => { composer.view.result.current.setInput('first message'); });
  await act(async () => {
    void composer.view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await answerCreate(jsonResponse({ success: true, data: { sessionId: 'session-new' } }, 201));

  assert.deepEqual(composer.established.map(([id, context]) => [id, context.chatLeft]), [['session-new', false]]);
  assert.equal(composer.added.length, 1);
});
