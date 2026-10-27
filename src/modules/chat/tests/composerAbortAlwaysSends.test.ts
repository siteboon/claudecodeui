import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * The composer's Stop shows whenever the session is busy. A stale
 * `canInterrupt: false` once made it do nothing while the turn kept running;
 * it now always asks the server, which refuses what it cannot abort.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const busy: SessionActivityMap = new Map([[
  'session-1',
  { statusText: null, canInterrupt: false, startedAt: 1 },
]]);

test('Stop sends chat.abort even when the activity says the turn cannot be interrupted', () => {
  const sent: Array<{ type: string; sessionId?: string }> = [];
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
      processingSessions: busy,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string; sessionId?: string }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );

  act(() => view.result.current.handleAbortSession());

  assert.deepEqual(sent.filter((message) => message.type === 'chat.abort'), [
    { type: 'chat.abort', sessionId: 'session-1' },
  ]);
});
