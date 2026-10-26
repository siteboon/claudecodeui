import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { sideQuestionStore } from '@/modules/chat/hooks/useSideQuestions';
import type { ChatMessage, NormalizedMessage, Project, ProjectSession, SideQuestion } from '@/shared/types';

/**
 * The store and the merge are only useful if the transcript the operator sees
 * runs through them: a history page that carries side questions has to come
 * out of `useChatSessionState` with the BTW pairs in place by time among the
 * session's own rows, and a later refresh of the newest page — what a reload
 * or a reconnect does — has to keep feeding the store.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      providers: {
        ...actual.api.providers,
        sessionMessages: (...args: unknown[]) => sessionMessages(...args),
        sessionTokenUsage: () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
      },
    },
  };
});

const SESSION_ID = 'session-1';
const project: Project = { projectId: 'project-1', path: '/repo', fullPath: '/repo', displayName: 'Repo', isStarred: false };
const session = { id: SESSION_ID, summary: 'S', lastActivity: '2026-10-26T10:05:00.000Z', messageCount: 4, __provider: 'claude' } as unknown as ProjectSession;

const text = (id: string, role: 'user' | 'assistant', content: string, timestamp: string): NormalizedMessage => ({
  id, kind: 'text', role, provider: 'claude', sessionId: SESSION_ID, content, timestamp,
} as NormalizedMessage);

const HISTORY = [
  text('m1', 'user', 'first prompt', '2026-10-26T10:00:00.000Z'),
  text('m2', 'assistant', 'first answer', '2026-10-26T10:02:00.000Z'),
  text('m3', 'user', 'second prompt', '2026-10-26T10:04:00.000Z'),
  text('m4', 'assistant', 'second answer', '2026-10-26T10:05:00.000Z'),
];

const side = (id: string, createdAt: string): SideQuestion => ({
  id, sessionId: SESSION_ID, question: `side question ${id}`, answer: `side answer ${id}`,
  status: 'done', error: null, model: null, createdAt, finishedAt: createdAt,
});

const page = (sideQuestions: SideQuestion[]) => ({
  ok: true,
  json: async () => ({ data: { messages: HISTORY, total: HISTORY.length, hasMore: false, sideQuestions } }),
});

const clearStore = () => {
  for (const item of sideQuestionStore.forSession(SESSION_ID)) sideQuestionStore.remove(item.id);
};

beforeEach(() => {
  clearStore();
  sessionMessages.mockReset();
});
afterEach(clearStore);

// Strings only: comparing message objects would print the whole transcript on failure.
const labels = (messages: ChatMessage[]) => messages
  .map((m) => (m.btw ? `btw:${String(m.content)}` : String(m.content ?? '')))
  .filter((label) => label !== '');

const renderSessionState = () => {
  // Created once per render of the test, not per render of the hook:
  // `resetStreamingState` is in the load effect's deps, so a new function on
  // every render would re-run the load on every render, without end.
  const sendMessage = vi.fn();
  const resetStreamingState = vi.fn();
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const lastSeqRef = { current: new Map<string, number>() };
  return renderHook(() => {
    const sessionStore = useSessionStore();
    const state = useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: session,
      ws: null,
      sendMessage,
      resetStreamingState,
      statusCheckSentAtRef,
      lastSeqRef,
      sessionStore,
    });
    return { sessionStore, state };
  });
};

describe('side questions in the transcript', () => {
  it('a history page with side questions comes out of chatMessages with the pairs in place by time', async () => {
    sessionMessages.mockResolvedValue(page([side('q1', '2026-10-26T10:03:00.000Z')]));

    const hook = renderSessionState();
    // The session's own rows arrive first; that proves the page loaded at all.
    await waitFor(() => assert.ok(labels(hook.result.current.state.chatMessages).includes('second answer'), 'history loaded'));

    await waitFor(() => assert.deepEqual(labels(hook.result.current.state.chatMessages), [
      'first prompt',
      'first answer',
      'btw:side question q1',
      'btw:side answer q1',
      'second prompt',
      'second answer',
    ]));

    const btwIds = hook.result.current.state.chatMessages.filter((m) => m.btw).map((m) => String(m.id));
    assert.deepEqual(btwIds, ['btw-q-q1', 'btw-a-q1']);
  });

  it('a refresh of the newest page puts its sideQuestions into the store too', async () => {
    sessionMessages.mockResolvedValue(page([]));
    const hook = renderSessionState();
    await waitFor(() => assert.ok(labels(hook.result.current.state.chatMessages).includes('second answer'), 'history loaded'));

    sessionMessages.mockResolvedValue(page([side('q2', '2026-10-26T10:06:00.000Z')]));
    await act(async () => {
      await hook.result.current.sessionStore.refreshLatestFromServer(SESSION_ID, { limit: 20 });
    });

    assert.ok(sessionMessages.mock.calls.length >= 2, 'the refresh asked the server');
    assert.deepEqual(sideQuestionStore.forSession(SESSION_ID).map((item) => item.id), ['q2']);
  });
});
