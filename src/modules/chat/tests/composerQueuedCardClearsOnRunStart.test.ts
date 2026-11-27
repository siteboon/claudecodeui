import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
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
let draftsResolver: ((response: Response) => void) | null = null;
let clearedScopes: string[] = [];

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      user: {
        ...actual.api.user,
        drafts: async () => (
          draftsResolver
            ? await new Promise<Response>((resolve) => {
              const finish = draftsResolver!;
              draftsResolver = null;
              const origResolve = resolve;
              // Hold until the test settles it manually via releaseDrafts().
              pendingDraftWaiter = (resp: Response) => {
                finish(resp);
                origResolve(resp);
              };
            })
            : jsonResponse({ success: true, drafts: serverDrafts })
        ),
        saveDraft: async () => jsonResponse({}),
        appendQueuedMessage: async (_scope: string, queuedMessage: unknown) => jsonResponse({
          success: true,
          queuedMessage,
          appended: false,
        }),
        clearQueuedMessage: async (scope: string) => {
          clearedScopes.push(scope);
          return jsonResponse({});
        },
      },
    },
  };
});

let pendingDraftWaiter: ((response: Response) => void) | null = null;

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};
const SESSION = { id: 'session-1' } as ProjectSession;
const SESSION_B = { id: 'session-2' } as ProjectSession;

const renderComposer = (isLoading: boolean, session: ProjectSession = SESSION) => renderHook(
  ({ loading, activeSession }: { loading: boolean; activeSession: ProjectSession }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: activeSession,
    currentSessionId: activeSession.id,
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
  { initialProps: { loading: isLoading, activeSession: session } },
);

beforeEach(async () => {
  localStorage.clear();
  serverDrafts = [];
  draftsResolver = null;
  pendingDraftWaiter = null;
  clearedScopes = [];
  resetChatDrafts();
  await appendQueuedMessage(SESSION.id, { content: 'queued follow-up' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the card goes as the next turn starts, not one poll later', async () => {
  const view = renderComposer(false);
  assert.equal(view.result.current.queuedDraft?.content, 'queued follow-up');

  view.rerender({ loading: true, activeSession: SESSION });

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

test('a pending reconciliation for session A does not overwrite session B after switching', async () => {
  await appendQueuedMessage(SESSION_B.id, { content: 'session B queued' });

  // Hold the drafts hydration triggered by session A going busy.
  let draftsCallCount = 0;
  draftsResolver = () => { draftsCallCount += 1; };

  const view = renderComposer(false, SESSION);
  assert.equal(view.result.current.queuedDraft?.content, 'queued follow-up');

  view.rerender({ loading: true, activeSession: SESSION });
  await waitFor(() => {
    assert.ok(pendingDraftWaiter !== null, 'expected session A reconciliation to be in flight');
  }, { timeout: 2_000 });

  // Switch to session B before session A's hydration finishes.
  view.rerender({ loading: true, activeSession: SESSION_B });
  assert.equal(view.result.current.queuedDraft?.content, 'session B queued');

  // Session A's hydration returns with a different queued message for A (and empty for A / different for B).
  await act(async () => {
    pendingDraftWaiter?.(jsonResponse({
      success: true,
      drafts: [
        { scope: SESSION.id, text: '', queuedMessage: { content: 'from A' } },
        { scope: SESSION_B.id, text: '', queuedMessage: { content: 'session B queued' } },
      ],
    }));
    await Promise.resolve();
  });

  // Session B's card and owner ref remain intact (editing clears session B, never A).
  assert.equal(view.result.current.queuedDraft?.content, 'session B queued');
  assert.equal(draftsCallCount, 1);
  act(() => {
    view.result.current.editQueuedDraft();
  });
  assert.equal(view.result.current.input, 'session B queued');
  assert.deepEqual(clearedScopes, [SESSION_B.id]);
});
