import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { appendQueuedMessage, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';
import type * as ApiModule from '@/shared/api';

/**
 * The queued card says "will send when this finishes". The server claims the
 * message the moment the session's next turn starts, so by then the card is
 * describing something already running. The five-second poll alone left it on
 * screen while the agent worked; the busy edge checks right away.
 */

let serverDrafts: unknown[] = [];

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    ...actual,
    api: {
      ...actual.api,
      user: {
        ...actual.api.user,
        drafts: async () => json({ success: true, drafts: serverDrafts }),
        saveDraft: async () => json({}),
        appendQueuedMessage: async (_scope: string, queuedMessage: unknown) => json({
          success: true,
          queuedMessage,
          appended: false,
        }),
        clearQueuedMessage: async () => json({}),
      },
    },
  };
});

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};
const SESSION = { id: 'session-1' } as ProjectSession;

const renderComposer = (isLoading: boolean) => renderHook(
  ({ loading }: { loading: boolean }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: SESSION,
    currentSessionId: SESSION.id,
    provider: 'claude',
    permissionMode: 'default' as PermissionMode,
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: loading,
    canAbortSession: true,
    tokenBudget: null,
    sendMessage: () => undefined,
    onSessionEstablished: () => undefined,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }),
  { initialProps: { loading: isLoading } },
);

beforeEach(async () => {
  localStorage.clear();
  serverDrafts = [];
  resetChatDrafts();
  await appendQueuedMessage(SESSION.id, { content: 'queued follow-up' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the card goes as the next turn starts, not one poll later', async () => {
  const view = renderComposer(false);
  assert.equal(view.result.current.queuedDraft?.content, 'queued follow-up');

  view.rerender({ loading: true });

  await waitFor(() => {
    assert.equal(view.result.current.queuedDraft, null);
  }, { timeout: 2_000 });
});

test('a card queued during a running turn stays until the server claims it', async () => {
  // The session is already busy when the message is queued: there is no busy
  // edge to react to, so a running turn alone must not clear the card.
  const view = renderComposer(true);
  assert.equal(view.result.current.queuedDraft?.content, 'queued follow-up');

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(view.result.current.queuedDraft?.content, 'queued follow-up');
});
