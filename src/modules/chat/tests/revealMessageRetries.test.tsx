import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * The background-tasks strip reveals a task's row by widening the visible
 * window and then scrolling to the row's wrapper. The widened window commits
 * after the current frame, so the first lookup runs before the row exists;
 * settling for the nearest row there scrolled to an unrelated row and ended
 * the retry chain, and the task's row never came into view.
 */

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }) } },
}));

const project: Project = { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo', isStarred: false };
const session: ProjectSession = { id: 'session-a', summary: 'A', lastActivity: '2026-01-01T00:00:00.000Z', messageCount: 1 } as ProjectSession;
const slot = { fetchedAt: 1, status: 'idle' as const, total: 0, hasMore: false, offset: 0 };
const store = {
  fetchFromServer: vi.fn(async () => slot),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn(() => []),
  getSessionSlot: vi.fn(() => slot),
};

const row = (timestamp: string) => {
  const element = document.createElement('div');
  element.setAttribute('data-message-timestamp', timestamp);
  element.scrollIntoView = vi.fn();
  return element;
};

// Frames run by hand, so a row can be added between two attempts the way a
// React commit adds it.
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  frames.length = 0;
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('revealing a row not yet rendered waits for it instead of scrolling to its neighbour', async () => {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const hook = renderHook(() =>
    useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: session,
      ws: null,
      sendMessage: vi.fn(),
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
    }),
  );
  const container = document.createElement('div');
  const neighbour = row('2026-08-21T10:32:09.000Z');
  container.appendChild(neighbour);
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container;
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });

  // First attempt: the target row has not been committed yet.
  assert.equal(frames.length, 1);
  await act(async () => { frames.shift()?.(0); });
  assert.equal((neighbour.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length, 0, 'the neighbour must not be scrolled to');
  assert.equal(frames.length, 1, 'the chain goes on');

  // The commit lands the row; the next attempt finds it.
  const target = row('2026-08-21T10:32:10.000Z');
  container.appendChild(target);
  await act(async () => { frames.shift()?.(0); });
  assert.equal((target.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  assert.equal(frames.length, 0);
});

test('the last attempt settles for the nearest row, for a hit collapsed inside a tool group', async () => {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const hook = renderHook(() =>
    useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: session,
      ws: null,
      sendMessage: vi.fn(),
      resetStreamingState: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
    }),
  );
  const container = document.createElement('div');
  const group = row('2026-08-21T10:32:09.000Z');
  container.appendChild(group);
  (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container;
  frames.length = 0;

  await act(async () => {
    hook.result.current.revealMessage({ type: 'assistant', content: '', timestamp: '2026-08-21T10:32:10.000Z' });
  });
  while (frames.length > 0) {
    await act(async () => { frames.shift()?.(0); });
  }
  assert.equal((group.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length, 1);
});
