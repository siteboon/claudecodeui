import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type * as ChatDrafts from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * The server sends a queued message by claiming it from the session's drafts.
 * The composer notices the claim only by the record disappearing, and that is
 * also the moment the run it started has to be watched — otherwise the card
 * goes and the message is nowhere in the conversation until the turn ends
 * (#1498).
 */

// What the server's drafts say about the session's queued message.
const serverQueue = vi.hoisted(() => ({ claimed: false }));

vi.mock('@/shared/chatDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatDrafts>();
  return {
    ...actual,
    hydrateChatDrafts: async () => undefined,
    readQueuedMessage: (scope: string) =>
      serverQueue.claimed ? null : actual.readQueuedMessage(scope),
  };
});

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  serverQueue.claimed = false;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a queued message the server claims is reported, so its run can be watched', async () => {
  const { useChatComposerState } = await import('@/modules/chat/hooks/useChatComposerState');
  const onQueuedMessageSent = vi.fn();
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
      // A turn is running, so Enter queues.
      isLoading: true,
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: () => undefined,
      onQueuedMessageSent,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );

  await act(async () => { view.result.current.setInput('second question'); });
  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });
  assert.equal(view.result.current.queuedDraft?.content, 'second question');

  // Still waiting: the card stays and nothing is reported.
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  assert.equal(onQueuedMessageSent.mock.calls.length, 0);
  assert.ok(view.result.current.queuedDraft);

  serverQueue.claimed = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

  assert.equal(view.result.current.queuedDraft, null);
  assert.deepEqual(onQueuedMessageSent.mock.calls, [['session-1']]);
});
