import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { ChatMessage, PermissionMode, Project, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * "Send now": a message submitted while a turn is running goes to that turn
 * (`chat.inject`), which takes it in at its next tool step, as the terminal
 * does. When the run cannot take it, the composer queues it as before.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const render = (accepted: boolean) => {
  const sent: Array<Record<string, unknown>> = [];
  const added: ChatMessage[] = [];
  const listeners = new Set<(event: ServerEvent) => void>();
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
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => {
        const frame = message as Record<string, unknown>;
        sent.push(frame);
        if (frame.type === 'chat.inject') {
          // The server answers on the socket a moment later.
          setTimeout(() => {
            listeners.forEach((listener) => listener({ kind: 'inject_result', requestId: frame.requestId, accepted, sessionId: SESSION.id }));
          }, 0);
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      scrollToBottom: () => undefined,
      addMessage: (message) => { added.push(message); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  return { view, sent, added, listeners };
};

const submit = async (view: ReturnType<typeof render>['view'], text: string) => {
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  clearQueuedMessage(SESSION.id);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a message sent during a running turn goes to that turn, not the queue', async () => {
  const { view, sent, added, listeners } = render(true);
  await submit(view, 'also check the logs');

  const injects = sent.filter((frame) => frame.type === 'chat.inject');
  assert.equal(injects.length, 1);
  assert.equal(injects[0].sessionId, SESSION.id);
  assert.equal(injects[0].content, 'also check the logs');
  assert.equal(view.result.current.queuedDraft, null, 'nothing is queued');
  assert.equal(added.at(-1)?.type, 'user');
  assert.equal(added.at(-1)?.content, 'also check the logs');
  assert.equal(view.result.current.input, '');
  assert.equal(listeners.size, 0, 'the one-shot listener is removed');
});

test('a message the running turn cannot take is queued as before', async () => {
  const { view, sent, added } = render(false);
  await submit(view, 'too late');

  assert.equal(sent.filter((frame) => frame.type === 'chat.inject').length, 1);
  await waitFor(() => assert.equal(view.result.current.queuedDraft?.content, 'too late'));
  assert.equal(added.length, 0, 'no bubble for a message that has not been sent');
});

test('a slash command typed during a running turn is queued, not sent now', async () => {
  const { view, sent } = render(true);
  await submit(view, '/compact');

  assert.equal(sent.filter((frame) => frame.type === 'chat.inject').length, 0);
  await waitFor(() => assert.equal(view.result.current.queuedDraft?.content, '/compact'));
});
