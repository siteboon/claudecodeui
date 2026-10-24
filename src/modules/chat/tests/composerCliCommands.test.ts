import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Commands the Claude Code CLI runs itself (/usage, /context, …) are sent as
 * typed. `/btw` goes to the side chat beside the transcript — also while a
 * turn is running — and never to the chat itself.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const render = (isLoading: boolean) => {
  const sent: Array<Record<string, unknown>> = [];
  const sideQuestions: string[] = [];
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
      onSideQuestion: (question) => { sideQuestions.push(question); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  return { view, sent, sideQuestions };
};

const submit = async (view: ReturnType<typeof render>['view'], text: string) => {
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
  clearQueuedMessage(SESSION.id);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('/btw hands the question to the side chat and sends nothing to the chat', async () => {
  const { view, sent, sideQuestions } = render(false);
  await submit(view, '/btw what does add(2, 2) return?');

  assert.deepEqual(sideQuestions, ['what does add(2, 2) return?']);
  assert.equal(sent.length, 0);
  assert.equal(view.result.current.input, '');
});

test('/btw works while a turn is running instead of being queued', async () => {
  const { view, sent, sideQuestions } = render(true);
  await submit(view, '/btw quick one');

  assert.deepEqual(sideQuestions, ['quick one']);
  assert.equal(view.result.current.queuedDraft, null);
  assert.equal(sent.filter((frame) => frame.type === 'chat.inject').length, 0);
});

test('/btw alone just opens the side chat', async () => {
  const { view, sideQuestions } = render(false);
  await submit(view, '/btw');

  assert.deepEqual(sideQuestions, ['']);
});

test('a CLI command typed in full is sent to Claude Code as written', async () => {
  const { view, sent } = render(false);
  await submit(view, '/usage');

  const sends = sent.filter((frame) => frame.type === 'chat.send');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, '/usage');
});
