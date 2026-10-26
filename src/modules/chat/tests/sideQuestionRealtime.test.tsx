import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { sideQuestionStore } from '@/modules/chat/hooks/useSideQuestions';
import type { NormalizedMessage, ProjectSession, ServerEvent, SideQuestion } from '@/shared/types';

/**
 * A side question never touches the session's transcript: its live events go
 * to the side-question store and nowhere else, and the rows a history page
 * carries beside the messages land in that same store. If a `side_question`
 * event reached the transcript store, the aside would be drawn as a session
 * row and counted as the session's last message.
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
      },
    },
  };
});

const SESSIONS = ['viewed-session', 'other-session', 'session-1'];

const clearStore = () => {
  for (const sessionId of SESSIONS) {
    for (const item of sideQuestionStore.forSession(sessionId)) {
      sideQuestionStore.remove(item.id);
    }
  }
};

beforeEach(clearStore);
afterEach(clearStore);

const row = (fields: Partial<SideQuestion> & Pick<SideQuestion, 'id'>): SideQuestion => ({
  sessionId: 'viewed-session',
  question: 'why?',
  answer: '',
  status: 'running',
  error: null,
  model: null,
  createdAt: '2026-10-26T10:00:00.000Z',
  finishedAt: null,
  ...fields,
});

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: Array<{ sessionId: string; msg: NormalizedMessage }> = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionIdle: () => {},
    onSessionBackground: () => {},
    getSessionActivity: () => undefined,
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (sessionId: string, msg: NormalizedMessage) => { appended.push({ sessionId, msg }); },
      getMessages: () => [],
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => {
    act(() => { listener?.(event); });
  };
  return { dispatch, appended };
};

const sideQuestionEvent = (fields: Record<string, unknown>): ServerEvent => ({
  kind: 'side_question',
  sessionId: 'viewed-session',
  timestamp: '2026-10-26T10:00:05.000Z',
  ...fields,
} as ServerEvent);

describe('side_question events', () => {
  it('reach the side-question store and never the transcript store', () => {
    const { dispatch, appended } = renderHandlers();

    // The fake transcript store is wired: an ordinary event lands in it.
    dispatch({ id: 'e-text', kind: 'text', role: 'assistant', content: 'session text', sessionId: 'viewed-session', provider: 'claude', timestamp: '2026-10-26T10:00:01.000Z' });
    assert.equal(appended.length, 1);

    dispatch(sideQuestionEvent({ sideQuestionId: 'q1', phase: 'started', sideQuestion: row({ id: 'q1' }) }));
    dispatch(sideQuestionEvent({ sideQuestionId: 'q1', phase: 'delta', text: 'Because' }));
    dispatch(sideQuestionEvent({ sideQuestionId: 'q1', phase: 'delta', text: ' it is.' }));

    const [running] = sideQuestionStore.forSession('viewed-session');
    assert.equal(running?.answer, 'Because it is.');

    const final = row({ id: 'q1', answer: 'Because it is.', status: 'done', finishedAt: '2026-10-26T10:00:09.000Z' });
    dispatch(sideQuestionEvent({ sideQuestionId: 'q1', phase: 'done', sideQuestion: final }));

    assert.deepEqual(sideQuestionStore.forSession('viewed-session'), [final]);
    assert.deepEqual(appended.map(({ msg }) => msg.kind), ['text']);
  });

  it('for a session that is not on screen reach the store too, and not the transcript store', () => {
    const { dispatch, appended } = renderHandlers();

    dispatch(sideQuestionEvent({
      sessionId: 'other-session',
      sideQuestionId: 'q2',
      phase: 'error',
      error: 'refused',
      sideQuestion: row({ id: 'q2', sessionId: 'other-session', status: 'error', error: 'refused' }),
    }));

    assert.deepEqual(sideQuestionStore.forSession('other-session').map((item) => item.status), ['error']);
    assert.deepEqual(appended, []);
  });
});

describe('history pages', () => {
  it('put the page\'s sideQuestions into the side-question store', async () => {
    const stored = row({ id: 'h1', sessionId: 'session-1', answer: 'Stored answer', status: 'done', finishedAt: '2026-10-26T10:00:09.000Z' });
    sessionMessages.mockReset();
    sessionMessages.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          messages: [{
            id: 'm1', kind: 'text', role: 'user', provider: 'claude', sessionId: 'session-1',
            content: 'hello', timestamp: '2026-10-26T09:59:00.000Z',
          }],
          total: 1,
          hasMore: false,
          sideQuestions: [stored],
        },
      }),
    });

    const view = renderHook(() => useSessionStore());
    await act(async () => {
      await view.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    assert.equal(sessionMessages.mock.calls.length, 1);
    assert.deepEqual(sideQuestionStore.forSession('session-1'), [stored]);
  });
});
