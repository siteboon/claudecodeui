import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A review fix in `useChatComposerState`: after a successful BTW the composer
 * clears only the typed text, never the attachments, and only when the ask
 * actually returned true. A disconnected ask (the hook's new `isConnected`
 * arg) must leave both the text and the frame untouched.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

type Frame = { type: string; sessionId?: string; sideQuestionId?: string; question?: string };

const render = (isConnected: boolean) => {
  const sent: Frame[] = [];
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
      processingSessions: new Map([[
        'session-1',
        { statusText: 'Writing', canInterrupt: true, startedAt: 1 },
      ]]) as SessionActivityMap,
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as Frame); },
      isConnected,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  const of = (type: string) => sent.filter((message) => message.type === type);
  return { view, of };
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  clearQueuedMessage(SESSION.id);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('BTW while disconnected keeps the typed text and sends no frame', async () => {
  const { view, of } = render(false);

  await act(async () => { view.result.current.setInput('are we there yet?'); });
  await act(async () => { await view.result.current.handleSendMenuChoice('btw'); });

  assert.equal(of('chat.btw').length, 0, 'no chat.btw frame is sent');
  assert.equal(view.result.current.input, 'are we there yet?', 'the typed text stays in the composer');
});

test('BTW while connected clears the text but keeps an attached file', async () => {
  const { view, of } = render(true);
  const file = new File(['content'], 'note.txt', { type: 'text/plain' });

  await act(async () => { view.result.current.setInput('what does this flag do?'); });
  await act(async () => { view.result.current.setAttachedFiles([file]); });

  await act(async () => { await view.result.current.handleSendMenuChoice('btw'); });

  assert.equal(of('chat.btw').length, 1, 'the ask went through');
  assert.equal(view.result.current.input, '', 'the text is cleared');
  assert.equal(view.result.current.attachedFiles.length, 1, 'the attached file is kept');
  assert.equal(view.result.current.attachedFiles[0]?.name, 'note.txt');
});
