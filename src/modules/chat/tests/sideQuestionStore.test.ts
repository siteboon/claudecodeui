import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import {
  sideQuestionStore,
  useAskSideQuestion,
  useDismissSideQuestion,
  useSideQuestions,
} from '@/modules/chat/hooks/useSideQuestions';
import type { SideQuestion, SideQuestionEvent } from '@/shared/types';
import type * as SharedApiModule from '@/shared/api';

/**
 * A side question lives beside the transcript, in one module-level store
 * per page. The server's list is the truth once it has a row; a question asked
 * from this tab exists locally before the server stores it, so it has to
 * survive a history refresh that raced the ask — but only while it runs.
 */

const dismissSideQuestion = vi.fn();

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      providers: {
        ...actual.api.providers,
        dismissSideQuestion: (...args: unknown[]) => dismissSideQuestion(...args),
      },
    },
  };
});

const SESSIONS = ['session-1', 'session-2'];

const row = (fields: Partial<SideQuestion> & Pick<SideQuestion, 'id'>): SideQuestion => ({
  sessionId: 'session-1',
  question: `question ${fields.id}`,
  answer: '',
  status: 'running',
  error: null,
  model: null,
  createdAt: '2026-10-26T10:00:00.000Z',
  finishedAt: null,
  ...fields,
});

const event = (
  fields: Omit<SideQuestionEvent, 'kind' | 'sessionId' | 'timestamp'> & Partial<Pick<SideQuestionEvent, 'sessionId'>>,
): SideQuestionEvent => ({
  kind: 'side_question',
  sessionId: 'session-1',
  timestamp: '2026-10-26T10:00:05.000Z',
  ...fields,
});

const ids = (sessionId: string) => sideQuestionStore.forSession(sessionId).map((item) => item.id);

// The store is module-level on purpose (every view of a session shares it), so
// each test empties it through its own public API rather than reloading it.
const clearStore = () => {
  for (const sessionId of SESSIONS) {
    for (const item of sideQuestionStore.forSession(sessionId)) {
      sideQuestionStore.remove(item.id);
    }
  }
};

beforeEach(() => {
  clearStore();
  dismissSideQuestion.mockReset();
  dismissSideQuestion.mockResolvedValue({ ok: true, json: async () => ({ data: { deleted: true } }) });
});

afterEach(clearStore);

describe('sideQuestionStore', () => {
  it('lists a session\'s side questions oldest first, and nothing for an unknown session', () => {
    sideQuestionStore.replaceForSession('session-1', [
      row({ id: 'late', createdAt: '2026-10-26T10:05:00.000Z', status: 'done' }),
      row({ id: 'early', createdAt: '2026-10-26T10:01:00.000Z', status: 'done' }),
      row({ id: 'middle', createdAt: '2026-10-26T10:03:00.000Z', status: 'done' }),
    ]);

    assert.deepEqual(ids('session-1'), ['early', 'middle', 'late']);
    assert.deepEqual(sideQuestionStore.forSession('no-such-session'), []);
  });

  it('replace: the server\'s row wins for every id it holds', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    const stored = row({ id: 'q1', question: 'why?', answer: 'Because.', status: 'done', finishedAt: '2026-10-26T10:00:09.000Z' });

    sideQuestionStore.replaceForSession('session-1', [stored]);

    assert.deepEqual(sideQuestionStore.forSession('session-1'), [stored]);
  });

  it('replace keeps a local entry the server lacks while it is running', () => {
    // Asked from this tab; the history response was cut before the row existed.
    sideQuestionStore.begin({ id: 'local', sessionId: 'session-1', question: 'still there?', createdAt: '2026-10-26T10:00:00.000Z' });

    sideQuestionStore.replaceForSession('session-1', []);

    assert.deepEqual(ids('session-1'), ['local']);
  });

  it('replace drops a finished or failed local entry the server lacks (it was dismissed elsewhere)', () => {
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'done-1', phase: 'done', sideQuestion: row({ id: 'done-1', status: 'done', answer: 'A' }) }));
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'failed-1', phase: 'error', error: 'boom', sideQuestion: row({ id: 'failed-1', status: 'error', error: 'boom' }) }));
    assert.deepEqual(ids('session-1').sort(), ['done-1', 'failed-1']);

    sideQuestionStore.replaceForSession('session-1', []);

    assert.deepEqual(ids('session-1'), []);
  });

  it('replace for one session leaves another session\'s entries alone', () => {
    sideQuestionStore.replaceForSession('session-2', [row({ id: 'other', sessionId: 'session-2', status: 'done' })]);

    sideQuestionStore.replaceForSession('session-1', [row({ id: 'mine', status: 'done' })]);

    assert.deepEqual(ids('session-2'), ['other']);
    assert.deepEqual(ids('session-1'), ['mine']);
  });

  it('begin adds the optimistic pending entry: running, no answer, no error', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });

    const [item] = sideQuestionStore.forSession('session-1');
    assert.equal(item.id, 'q1');
    assert.equal(item.sessionId, 'session-1');
    assert.equal(item.question, 'why?');
    assert.equal(item.answer, '');
    assert.equal(item.status, 'running');
    assert.equal(item.error, null);
    assert.equal(item.createdAt, '2026-10-26T10:00:00.000Z');
    assert.equal(item.finishedAt, null);
  });

  it('started with a row upserts it, also for an id this tab never asked', () => {
    const started = row({ id: 'from-other-tab', question: 'asked elsewhere' });

    sideQuestionStore.applyEvent(event({ sideQuestionId: 'from-other-tab', phase: 'started', sideQuestion: started }));

    assert.deepEqual(sideQuestionStore.forSession('session-1'), [started]);
  });

  it('delta appends to a known id', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });

    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'delta', text: 'Be' }));
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'delta', text: 'cause.' }));

    const [item] = sideQuestionStore.forSession('session-1');
    assert.equal(item.answer, 'Because.');
    assert.equal(item.status, 'running');
  });

  it('delta for an unknown id is ignored', () => {
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'never-seen', phase: 'delta', text: 'orphan' }));

    assert.deepEqual(sideQuestionStore.forSession('session-1'), []);
  });

  it('done with the whole row replaces what the deltas built, so a tab that missed some ends complete', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'delta', text: 'Bec' }));
    const final = row({ id: 'q1', question: 'why?', answer: 'Because it is.', status: 'done', model: 'opus', finishedAt: '2026-10-26T10:00:09.000Z' });

    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'done', sideQuestion: final }));

    assert.deepEqual(sideQuestionStore.forSession('session-1'), [final]);
  });

  it('error with a row upserts the row', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    const failed = row({ id: 'q1', question: 'why?', answer: 'Part', status: 'error', error: 'runtime died', finishedAt: '2026-10-26T10:00:09.000Z' });

    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'error', error: 'runtime died', sideQuestion: failed }));

    assert.deepEqual(sideQuestionStore.forSession('session-1'), [failed]);
  });

  it('error without a row marks a known id failed with the error, keeping the answer so far', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'delta', text: 'Part' }));

    sideQuestionStore.applyEvent(event({ sideQuestionId: 'q1', phase: 'error', error: 'refused' }));

    const [item] = sideQuestionStore.forSession('session-1');
    assert.equal(item.status, 'error');
    assert.equal(item.error, 'refused');
    assert.equal(item.answer, 'Part');
    assert.equal(item.question, 'why?');
  });

  it('error without a row for an unknown id creates nothing', () => {
    sideQuestionStore.applyEvent(event({ sideQuestionId: 'never-seen', phase: 'error', error: 'refused' }));

    assert.deepEqual(sideQuestionStore.forSession('session-1'), []);
  });

  it('remove takes the entry out', () => {
    sideQuestionStore.replaceForSession('session-1', [row({ id: 'a', status: 'done' }), row({ id: 'b', status: 'done', createdAt: '2026-10-26T10:01:00.000Z' })]);

    sideQuestionStore.remove('a');

    assert.deepEqual(ids('session-1'), ['b']);
  });

  it('subscribe hears every change until it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = sideQuestionStore.subscribe(listener);

    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    const afterBegin = listener.mock.calls.length;
    assert.ok(afterBegin >= 1);

    unsubscribe();
    sideQuestionStore.remove('q1');

    assert.equal(listener.mock.calls.length, afterBegin);
  });
});

describe('useSideQuestions', () => {
  it('returns the same array between store changes and a new one after a change', () => {
    const { result, rerender } = renderHook(() => useSideQuestions('session-1'));
    // Identity is compared with `===` inside `assert.ok`: `assert.equal` and
    // `assert.deepEqual` are type assertions and would narrow `result.current`.
    const first = result.current;
    assert.equal(first.length, 0);

    rerender();
    assert.ok(result.current === first, 'the same array while nothing changed');

    act(() => {
      sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });
    });
    const second = result.current;
    assert.ok(second !== first, 'a new array after a change');
    assert.deepEqual(second.map((item) => item.id), ['q1']);

    rerender();
    assert.ok(result.current === second, 'the same array again while nothing changed');
  });

  it('returns an empty list without a session', () => {
    sideQuestionStore.begin({ id: 'q1', sessionId: 'session-1', question: 'why?', createdAt: '2026-10-26T10:00:00.000Z' });

    const { result } = renderHook(() => useSideQuestions(null));

    assert.deepEqual(result.current, []);
  });
});

describe('useAskSideQuestion', () => {
  it('trims, begins the pending entry and sends the chat.side_question frame through the sendMessage it was given', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    let accepted = false;
    act(() => {
      accepted = result.current('session-1', '  why is this slow?  ', { model: 'claude-opus-4' });
    });

    assert.equal(accepted, true);
    assert.equal(sendMessage.mock.calls.length, 1);
    const frame = sendMessage.mock.calls[0][0] as Record<string, unknown>;
    assert.equal(typeof frame.sideQuestionId, 'string');
    // The server accepts 1 to 100 characters of [A-Za-z0-9_-] and refuses the rest.
    assert.match(frame.sideQuestionId as string, /^[A-Za-z0-9_-]{1,100}$/);
    assert.deepEqual(frame, {
      type: 'chat.side_question',
      sessionId: 'session-1',
      sideQuestionId: frame.sideQuestionId,
      question: 'why is this slow?',
      options: { model: 'claude-opus-4' },
    });

    const items = sideQuestionStore.forSession('session-1');
    assert.equal(items.length, 1);
    assert.equal(items[0].id, frame.sideQuestionId);
    assert.equal(items[0].question, 'why is this slow?');
    assert.equal(items[0].status, 'running');
  });

  it('sends no model when none is given', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    act(() => {
      result.current('session-1', 'why?');
    });

    const frame = sendMessage.mock.calls[0][0] as { type: string; question: string; options?: { model?: string } };
    assert.equal(frame.type, 'chat.side_question');
    assert.equal(frame.question, 'why?');
    assert.equal(frame.options?.model, undefined);
  });

  it('gives each question its own id', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    act(() => {
      result.current('session-1', 'one?');
      result.current('session-1', 'two?');
    });

    const [first, second] = sendMessage.mock.calls.map(([frame]) => (frame as { sideQuestionId: string }).sideQuestionId);
    assert.notEqual(first, second);
    assert.equal(sideQuestionStore.forSession('session-1').length, 2);
  });

  it('refuses an empty question: false, nothing sent, nothing stored', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    let accepted = true;
    act(() => {
      accepted = result.current('session-1', '   \n ');
    });

    assert.equal(accepted, false);
    assert.equal(sendMessage.mock.calls.length, 0);
    assert.deepEqual(sideQuestionStore.forSession('session-1'), []);
  });

  it('refuses without a session: false, nothing sent', () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    const outcomes: boolean[] = [];
    act(() => {
      outcomes.push(result.current('', 'why?'));
      // A brand-new chat has no session id yet; the composer passes null then.
      outcomes.push(result.current(null as unknown as string, 'why?'));
    });

    assert.deepEqual(outcomes, [false, false]);
    assert.equal(sendMessage.mock.calls.length, 0);
  });
});

describe('useDismissSideQuestion', () => {
  it('calls the DELETE helper for that session and id, then removes the entry', async () => {
    sideQuestionStore.replaceForSession('session-1', [row({ id: 'q1', status: 'done', answer: 'A' })]);
    const presentWhenCalled: boolean[] = [];
    dismissSideQuestion.mockImplementation(async () => {
      presentWhenCalled.push(ids('session-1').includes('q1'));
      return { ok: true, json: async () => ({ data: { deleted: true } }) };
    });
    const { result } = renderHook(() => useDismissSideQuestion());

    await act(async () => {
      await result.current('session-1', 'q1');
    });

    assert.deepEqual(dismissSideQuestion.mock.calls, [['session-1', 'q1']]);
    assert.deepEqual(presentWhenCalled, [true]);
    assert.deepEqual(ids('session-1'), []);
  });
});
