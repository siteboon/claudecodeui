import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project } from '@/shared/types';

/**
 * A new chat awaits session creation before it sends and clears the input. On a
 * slow link the send button looks dead for that whole wait, so it gets pressed
 * again; every extra press used to allocate its own session and send the same
 * prompt into it, leaving several identical chats behind.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      providers: { createSession },
    },
  };
});

const renderComposer = (sendMessage: (message: unknown) => void) => renderHook(() => useChatComposerState({
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
  canAbortSession: false,
  tokenBudget: null,
  sendMessage,
  scrollToBottom: () => undefined,
  addMessage: () => undefined,
  setIsUserScrolledUp: () => undefined,
  setPendingPermissionRequests: () => undefined,
}));

const fakeSubmitEvent = () => ({ preventDefault: () => undefined }) as never;

beforeEach(() => {
  localStorage.clear();
  resetChatDrafts();
  createSession.mockReset();
});

test('pressing send again while a new session is being created sends only once', async () => {
  const pendingCreates: Array<(value: unknown) => void> = [];
  createSession.mockImplementation(() => new Promise((resolve) => {
    pendingCreates.push(resolve);
  }));
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);

  await act(async () => {
    view.result.current.setInput('analyse the last 28 days');
  });

  let presses: Promise<void>[] = [];
  await act(async () => {
    // The input is still there while creation is pending, so the second press
    // submits the same text again.
    presses = [
      view.result.current.handleSubmit(fakeSubmitEvent()),
      view.result.current.handleSubmit(fakeSubmitEvent()),
    ];
  });

  await act(async () => {
    pendingCreates.forEach((resolve) => resolve({
      ok: true,
      json: async () => ({ data: { sessionId: 'session-new' } }),
    }));
    await Promise.all(presses);
  });

  assert.equal(createSession.mock.calls.length, 1);
  assert.equal(sendMessage.mock.calls.length, 1);
});

test('a failed submit does not block the next one', async () => {
  createSession.mockResolvedValueOnce({ ok: false, status: 502 });
  createSession.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { sessionId: 'session-new' } }) });
  const sendMessage = vi.fn();
  const view = renderComposer(sendMessage);

  await act(async () => {
    view.result.current.setInput('retry me');
  });
  await act(async () => {
    await view.result.current.handleSubmit(fakeSubmitEvent());
  });
  await act(async () => {
    await view.result.current.handleSubmit(fakeSubmitEvent());
  });

  assert.equal(createSession.mock.calls.length, 2);
  assert.equal(sendMessage.mock.calls.length, 1);
});
