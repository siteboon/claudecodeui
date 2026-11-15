import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { PermissionMode, Project, SessionActivityMap } from '@/shared/types';

/**
 * A review fix in `useChatComposerState`: `/btw <question>` was only
 * intercepted when a session already existed (`sessionKey` truthy). In a
 * brand-new chat — no `selectedSession`, no `currentSessionId` yet —
 * `/btw` fell through to the normal submit path, which allocates a session
 * and sends the raw `/btw ...` text through `chat.send` as an ordinary
 * turn, contradicting the comment above that branch ("never becomes a
 * turn"). `/btw` is now recognised in every state; without a session it is
 * refused with an error, the same way an unsupported provider is refused,
 * and the typed text stays for the user to resend once a session exists.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

type Frame = { type: string; sessionId?: string; question?: string };
type AddedRow = { type?: string; content?: unknown };

const NO_SESSION = 'Side questions need an existing chat; this one has not started yet.';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST') {
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return new Response(JSON.stringify({ success: true, queuedMessage, appended: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  clearQueuedMessage('new-chat');
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('/btw <question> in a brand-new chat (no session yet) is refused, keeps the input, and never allocates a session', async () => {
  const sent: Frame[] = [];
  const added: AddedRow[] = [];
  const createSessionCalls: unknown[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/providers/sessions') && init?.method === 'POST') {
      createSessionCalls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { sessionId: 'new-session' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const view = renderHook(() => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: null,
    currentSessionId: null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    processingSessions: new Map() as SessionActivityMap,
    canAbortSession: false,
    tokenBudget: null,
    supportsSideQuestions: true,
    sendMessage: (message) => { sent.push(message as Frame); },
    scrollToBottom: () => undefined,
    addMessage: (message) => { added.push(message as AddedRow); },
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }));

  await act(async () => { view.result.current.setInput('/btw why is this test slow?'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.deepEqual(sent.map((message) => message.type), [], 'no chat.send, no chat.side_question');
  assert.equal(createSessionCalls.length, 0, 'a session is never allocated for a refused /btw');
  assert.equal(view.result.current.input, '/btw why is this test slow?', 'the typed text stays');
  const errors = added.filter((row) => row.type === 'error');
  assert.equal(errors.length, 1, 'one error row');
  assert.equal(errors[0]?.content, NO_SESSION);
});

// CodeRabbit: Option/Alt+Enter calls `askSideQuestionAndClear` directly from
// `handleKeyDown`, bypassing the `/btw` branch above that refuses with
// `NO_SESSION` when there is no session yet. `useAskSideQuestion` already
// refuses a null `sessionId` on its own (returns `false`, asks nothing), so
// the keypress just did nothing — no error, no explanation, input untouched.
// It must refuse the same way `/btw` does in the same state.
test('Option/Alt+Enter in a brand-new chat (no session yet) is refused, keeps the input, and never allocates a session', async () => {
  const sent: Frame[] = [];
  const added: AddedRow[] = [];
  const createSessionCalls: unknown[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/providers/sessions') && init?.method === 'POST') {
      createSessionCalls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { sessionId: 'new-session' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const view = renderHook(() => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: null,
    currentSessionId: null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    processingSessions: new Map() as SessionActivityMap,
    canAbortSession: false,
    tokenBudget: null,
    supportsSideQuestions: true,
    sendMessage: (message) => { sent.push(message as Frame); },
    scrollToBottom: () => undefined,
    addMessage: (message) => { added.push(message as AddedRow); },
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }));

  await act(async () => { view.result.current.setInput('what does this flag do?'); });
  await act(async () => {
    view.result.current.handleKeyDown({
      key: 'Enter',
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined,
      nativeEvent: { isComposing: false },
    } as unknown as Parameters<typeof view.result.current.handleKeyDown>[0]);
  });

  assert.deepEqual(sent.map((message) => message.type), [], 'no chat.send, no chat.side_question');
  assert.equal(createSessionCalls.length, 0, 'a session is never allocated for a refused side question');
  assert.equal(view.result.current.input, 'what does this flag do?', 'the typed text stays');
  const errors = added.filter((row) => row.type === 'error');
  assert.equal(errors.length, 1, 'one error row');
  assert.equal(errors[0]?.content, NO_SESSION);
});
