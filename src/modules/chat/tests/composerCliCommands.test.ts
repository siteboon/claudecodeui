import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SideQuestionData } from '@/shared/types';

/**
 * Commands the Claude Code CLI runs itself (/usage, /context, …) are sent as
 * typed. `/btw` is answered beside the chat — also while a turn is running.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const render = (isLoading: boolean) => {
  const sent: Array<Record<string, unknown>> = [];
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
      isLoading,
      canAbortSession: isLoading,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as Record<string, unknown>); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  return { view, sent };
};

const submit = async (view: ReturnType<typeof render>['view'], text: string) => {
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

const btwCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/providers/claude/btw'));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/providers/claude/btw')) {
      return jsonResponse({ success: true, data: { answer: 'It returns **4**.' } });
    }
    return jsonResponse([]);
  }));
  clearQueuedMessage(SESSION.id);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('/btw asks the side question and shows the answer, sending nothing to the chat', async () => {
  const { view, sent } = render(false);
  await submit(view, '/btw what does add(2, 2) return?');

  assert.equal(btwCalls().length, 1);
  const body = JSON.parse(String(btwCalls()[0][1]?.body));
  assert.deepEqual(body, { sessionId: 'session-1', question: 'what does add(2, 2) return?', model: 'test-model' });
  await waitFor(() => assert.equal((view.result.current.commandModalPayload?.data as SideQuestionData)?.answer, 'It returns **4**.'));
  assert.equal(view.result.current.commandModalPayload?.kind, 'btw');
  assert.equal(sent.length, 0);
  assert.equal(view.result.current.input, '');
});

test('/btw works while a turn is running instead of being queued', async () => {
  const { view, sent } = render(true);
  await submit(view, '/btw quick one');

  assert.equal(btwCalls().length, 1);
  assert.equal(view.result.current.queuedDraft, null);
  assert.equal(sent.filter((frame) => frame.type === 'chat.inject').length, 0);
});

test('/btw without a question explains what to type', async () => {
  const { view } = render(false);
  await submit(view, '/btw');

  assert.equal(btwCalls().length, 0);
  assert.match(String((view.result.current.commandModalPayload?.data as SideQuestionData)?.error), /Type a question/);
});

test('a CLI command typed in full is sent to Claude Code as written', async () => {
  const { view, sent } = render(false);
  await submit(view, '/usage');

  const sends = sent.filter((frame) => frame.type === 'chat.send');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, '/usage');
});
