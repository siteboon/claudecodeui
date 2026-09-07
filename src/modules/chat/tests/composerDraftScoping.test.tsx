import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts, writeDraftText } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Drafts used to be keyed by project, so every session in a project shared one
 * draft and switching sessions carried the previous one's half-typed message
 * across. They are keyed by session now (and by project only for a chat that
 * has not been sent yet), which is what lets a draft be picked up on another
 * device against the session it belongs to.
 *
 * These tests drive the real hook, so the effect ordering that decides which
 * scope a keystroke lands in is exercised rather than described.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

// The composer only ever reaches the network through these; stubbing them keeps
// the test about draft scoping rather than about fetch behaviour in jsdom.
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
    },
  };
});

const renderComposer = (selectedSession: ProjectSession | null) => renderHook(
  ({ session }: { session: ProjectSession | null }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: () => undefined,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }),
  { initialProps: { session: selectedSession } },
);

beforeEach(() => {
  localStorage.clear();
  // The drafts store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's drafts into the next.
  resetChatDrafts();
});

test('a draft is stored under the open session, not the project', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('for session A');
  });

  assert.equal(readDraftText('session-a'), 'for session A');
  assert.equal(readDraftText(`project:${PROJECT.projectId}`), '');
});

test('a chat with no session yet is stored under its project', async () => {
  const view = renderComposer(null);

  await act(async () => {
    view.result.current.setInput('not sent yet');
  });

  assert.equal(readDraftText(`project:${PROJECT.projectId}`), 'not sent yet');
});

test('switching sessions swaps the draft instead of carrying it across', async () => {
  writeDraftText('session-b', 'for session B');
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('for session A');
  });

  await act(async () => {
    view.rerender({ session: { id: 'session-b' } });
  });

  assert.equal(view.result.current.input, 'for session B');
  assert.equal(
    readDraftText('session-a'),
    'for session A',
    "the previous session's draft must survive the switch",
  );
  assert.equal(
    readDraftText('session-b'),
    'for session B',
    "the new session's draft must not be overwritten by the previous one's text",
  );
});

test('switching back restores the draft that was left behind', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('for session A');
  });
  await act(async () => {
    view.rerender({ session: { id: 'session-b' } });
  });
  await act(async () => {
    view.rerender({ session: { id: 'session-a' } });
  });

  assert.equal(view.result.current.input, 'for session A');
});

test('a draft written on another device is picked up while the session is open', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    // Stands in for a hydrate delivering what was typed elsewhere.
    writeDraftText('session-a', 'typed on the phone');
  });

  assert.equal(view.result.current.input, 'typed on the phone');
});

test('clearing the composer clears that session\'s stored draft', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('typed');
  });
  assert.equal(readDraftText('session-a'), 'typed');

  await act(async () => {
    view.result.current.setInput('');
  });

  assert.equal(readDraftText('session-a'), '');
});
