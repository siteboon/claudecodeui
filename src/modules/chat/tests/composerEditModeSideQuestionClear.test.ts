import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { ChatMessage, PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A bug fix: asking a side question while editing a previously sent message
 * must end edit mode, the same way cancelling the edit does. Before the fix,
 * `clearComposerAfterSideQuestion` emptied the text but left `editingAnchorId`
 * set, so the "editing" banner stayed over an empty composer and the next
 * plain send went out as `chat.edit-send`, replacing the edited turn (and
 * everything after it) instead of sending a new message.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

type Frame = { type: string; sessionId?: string; anchorId?: string; content?: string };

const render = () => {
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
      // Idle: editing a sent message is only offered while idle, and idle is
      // also the state where a plain Enter sends immediately rather than
      // opening the background-work dialog.
      isLoading: false,
      processingSessions: new Map() as SessionActivityMap,
      canAbortSession: false,
      tokenBudget: null,
      supportsSideQuestions: true,
      sendMessage: (message) => { sent.push(message as Frame); },
      isConnected: true,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  const of = (type: string) => sent.filter((message) => message.type === type);
  return { view, of };
};

const EDITED_MESSAGE: ChatMessage = {
  type: 'user',
  content: 'the original message',
  timestamp: Date.now(),
  transcriptAnchorId: 'anchor-1',
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

test('Asking a side question while editing ends edit mode, so the next send is a plain send', async () => {
  const { view, of } = render();

  await act(async () => { view.result.current.beginEditMessage(EDITED_MESSAGE); });
  assert.equal(view.result.current.editingAnchorId, 'anchor-1', 'editing started');

  await act(async () => { await view.result.current.handleSendMenuChoice('sideQuestion'); });

  assert.equal(of('chat.side_question').length, 1, 'the side question went out');
  assert.equal(view.result.current.input, '', 'the composer text is cleared');
  // The bug: editingAnchorId stayed set here, so the amber "editing" banner
  // kept showing over the now-empty composer.
  assert.equal(view.result.current.editingAnchorId, null, 'edit mode is over once the side question is asked');

  await act(async () => { view.result.current.setInput('a brand new message'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  const sendFrames = of('chat.send');
  const editSendFrames = of('chat.edit-send');
  assert.equal(sendFrames.length, 1, 'the next send is a plain send');
  assert.equal(editSendFrames.length, 0, 'not an edit-send, which would replace the edited turn and everything after it');
  assert.equal(sendFrames[0]?.anchorId, undefined, 'no anchor is carried over from the ended edit');
});
