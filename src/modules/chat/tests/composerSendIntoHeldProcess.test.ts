import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { ChatMessage, PermissionMode, Project, ProjectSession, ServerEvent, SessionActivityMap } from '@/shared/types';

/**
 * A session whose turn ended while helpers (agents, background commands) keep
 * running is not busy: its process takes a new message as a new turn and the
 * helpers keep going, as in the terminal. Only when that process cannot take
 * it does the composer ask whether to stop the work or queue.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const helpersRunning: SessionActivityMap = new Map([[
  'session-1',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [{ taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Explore the settings panels', startedAt: 1 }],
  },
]]);

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
      isLoading: false,
      processingSessions: helpersRunning,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => {
        const frame = message as Record<string, unknown>;
        sent.push(frame);
        if (frame.type === 'chat.inject') {
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
  return { view, sent, added };
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

test('a message to a session with helpers running goes into its process without asking', async () => {
  const { view, sent, added } = render(true);
  await act(async () => { view.result.current.setInput('how are the explorers doing?'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.equal(view.result.current.backgroundSendPrompt, null, 'no stop-or-queue question');
  assert.deepEqual(sent.map((frame) => frame.type), ['chat.inject']);
  assert.equal(added.at(-1)?.content, 'how are the explorers doing?');
  assert.equal(view.result.current.input, '');
});

test('when the process cannot take it, the composer asks as before', async () => {
  const { view, sent } = render(false);
  await act(async () => { view.result.current.setInput('hello'); });
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await waitFor(() => assert.notEqual(view.result.current.backgroundSendPrompt, null));
  assert.equal(sent.filter((frame) => frame.type === 'chat.send').length, 0);
  await act(async () => {
    view.result.current.resolveBackgroundSendPrompt('cancel');
    await pending;
  });
});
