import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { mergeSideQuestions } from '@/modules/chat/utils/sideQuestions';
import type { ChatMessage, SideQuestion } from '@/shared/types';

/**
 * A side question is drawn where it was asked: as a question row and an answer
 * row, both marked `sideQuestion`, placed by time among the session's own rows. The
 * session's rows are never reordered, and a pair whose place is not loaded yet
 * stays out instead of jumping around while older pages arrive.
 */

const message = (id: string, type: 'user' | 'assistant', timestamp: string): ChatMessage => ({
  id,
  type,
  content: `${type} ${id}`,
  timestamp,
});

const item = (fields: Partial<SideQuestion> & Pick<SideQuestion, 'id' | 'createdAt'>): SideQuestion => ({
  sessionId: 'session-1',
  question: `question ${fields.id}`,
  answer: `answer ${fields.id}`,
  status: 'done',
  error: null,
  model: null,
  finishedAt: null,
  ...fields,
});

const order = (messages: ChatMessage[]) => messages.map((m) => String(m.id));

const A = message('a', 'user', '2026-10-26T10:00:00.000Z');
const B = message('b', 'assistant', '2026-10-26T10:02:00.000Z');
const C = message('c', 'user', '2026-10-26T10:04:00.000Z');

describe('mergeSideQuestions', () => {
  it('gives the same array back when there are no side questions', () => {
    const messages = [A, B, C];

    assert.equal(mergeSideQuestions(messages, []), messages);
    assert.equal(mergeSideQuestions(messages, [], { hasOlder: true }), messages);
  });

  it('places a pair after every row at or before its time, and before the later rows', () => {
    const merged = mergeSideQuestions([A, B, C], [item({ id: 'q1', createdAt: '2026-10-26T10:03:00.000Z' })]);

    assert.deepEqual(order(merged), ['a', 'b', 'side-question-q-q1', 'side-question-a-q1', 'c']);
  });

  it('places a pair asked at the same moment as a row after that row', () => {
    const merged = mergeSideQuestions([A, B, C], [item({ id: 'q1', createdAt: '2026-10-26T10:02:00.000Z' })]);

    assert.deepEqual(order(merged), ['a', 'b', 'side-question-q-q1', 'side-question-a-q1', 'c']);
  });

  it('places a pair newer than everything at the end, and one older than everything at the start', () => {
    const merged = mergeSideQuestions([A, B, C], [
      item({ id: 'old', createdAt: '2026-10-26T09:00:00.000Z' }),
      item({ id: 'new', createdAt: '2026-10-26T11:00:00.000Z' }),
    ]);

    assert.deepEqual(order(merged), ['side-question-q-old', 'side-question-a-old', 'a', 'b', 'c', 'side-question-q-new', 'side-question-a-new']);
  });

  it('a row without a readable timestamp does not move a pair', () => {
    const untimed = { id: 'x', type: 'assistant', content: 'no time', timestamp: 'not a date' } as ChatMessage;

    const merged = mergeSideQuestions([A, untimed, B], [item({ id: 'q1', createdAt: '2026-10-26T10:03:00.000Z' })]);

    // The unreadable row sits before B, which is at or before the pair: the
    // pair still goes after B rather than stopping in front of the unreadable row.
    assert.deepEqual(order(merged), ['a', 'x', 'b', 'side-question-q-q1', 'side-question-a-q1']);
  });

  it('a pair between two readable rows goes right after the earlier one, before an unreadable row', () => {
    // Contract ruling: walk back from the end, skip unreadable rows, insert
    // right after the first readable timestamp at or before createdAt.
    const untimed = { id: 'x', type: 'assistant', content: 'no time', timestamp: 'not a date' } as ChatMessage;

    const merged = mergeSideQuestions([A, untimed, B], [item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z' })]);

    assert.deepEqual(order(merged), ['a', 'side-question-q-q1', 'side-question-a-q1', 'x', 'b']);
  });

  it('keeps several pairs in their order, each question directly before its answer', () => {
    const merged = mergeSideQuestions([A, B, C], [
      item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z' }),
      item({ id: 'q2', createdAt: '2026-10-26T10:01:30.000Z' }),
      item({ id: 'q3', createdAt: '2026-10-26T10:05:00.000Z' }),
    ]);

    assert.deepEqual(order(merged), [
      'a',
      'side-question-q-q1', 'side-question-a-q1',
      'side-question-q-q2', 'side-question-a-q2',
      'b', 'c',
      'side-question-q-q3', 'side-question-a-q3',
    ]);
  });

  it('makes the question a user row and the answer an assistant row, both marked sideQuestion', () => {
    const merged = mergeSideQuestions([A], [item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', question: 'why?', answer: 'Because.' })]);
    const question = merged.find((m) => m.id === 'side-question-q-q1');
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(question && answer);
    assert.equal(question.type, 'user');
    assert.equal(question.content, 'why?');
    assert.deepEqual(question.sideQuestion, { sideQuestionId: 'q1', sessionId: 'session-1', status: 'done' });
    assert.equal(answer.type, 'assistant');
    assert.equal(answer.content, 'Because.');
    assert.deepEqual(answer.sideQuestion, { sideQuestionId: 'q1', sessionId: 'session-1', status: 'done' });
    assert.ok(!answer.isStreaming);
    // The session's own row is left exactly as it was.
    assert.equal(merged[0], A);
    assert.equal(A.sideQuestion, undefined);
  });

  it('marks the answer streaming while the side question runs', () => {
    const merged = mergeSideQuestions([A], [item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', answer: 'Part', status: 'running' })]);
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(answer);
    assert.equal(answer.isStreaming, true);
    assert.equal(answer.content, 'Part');
    assert.deepEqual(answer.sideQuestion, { sideQuestionId: 'q1', sessionId: 'session-1', status: 'running' });
  });

  it('a failed side question shows the answer so far followed by the error in italics', () => {
    const merged = mergeSideQuestions([A], [
      item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', answer: 'Partial answer', status: 'error', error: 'The runtime stopped' }),
    ]);
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(answer);
    const content = String(answer.content);
    assert.ok(!answer.isStreaming);
    assert.deepEqual(answer.sideQuestion, { sideQuestionId: 'q1', sessionId: 'session-1', status: 'error' });
    assert.ok(content.startsWith('Partial answer'), content);
    assert.match(content, /([*_])The runtime stopped\1\s*$/);
  });

  it('a failed side question with no answer yet shows only the error in italics', () => {
    const merged = mergeSideQuestions([A], [
      item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', answer: '', status: 'error', error: 'Refused' }),
    ]);
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(answer);
    assert.match(String(answer.content).trim(), /^([*_])Refused\1$/);
  });

  it('a failed side question without an error text says it failed, in English italics by default', () => {
    const merged = mergeSideQuestions([A], [
      item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', answer: '', status: 'error', error: null }),
    ]);
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(answer);
    assert.match(String(answer.content).trim(), /^([*_])The side question failed\.\1$/);
  });

  it('a failed side question without an error text shows the failedText it was given, in italics', () => {
    const merged = mergeSideQuestions([A], [
      item({ id: 'q1', createdAt: '2026-10-26T10:01:00.000Z', answer: '', status: 'error', error: null }),
    ], { failedText: 'Die Nebenfrage ist fehlgeschlagen.' });
    const answer = merged.find((m) => m.id === 'side-question-a-q1');

    assert.ok(answer);
    assert.match(String(answer.content).trim(), /^([*_])Die Nebenfrage ist fehlgeschlagen\.\1$/);
  });

  it('with older pages not loaded, leaves out a pair older than the oldest loaded row', () => {
    const items = [
      item({ id: 'before-window', createdAt: '2026-10-26T09:00:00.000Z' }),
      item({ id: 'at-oldest', createdAt: '2026-10-26T10:00:00.000Z' }),
      item({ id: 'inside', createdAt: '2026-10-26T10:03:00.000Z' }),
    ];

    const cut = mergeSideQuestions([A, B, C], items, { hasOlder: true });
    assert.deepEqual(order(cut), ['a', 'side-question-q-at-oldest', 'side-question-a-at-oldest', 'b', 'side-question-q-inside', 'side-question-a-inside', 'c']);

    // Once everything is loaded the same pair has its real place at the top.
    const full = mergeSideQuestions([A, B, C], items, { hasOlder: false });
    assert.deepEqual(order(full).slice(0, 2), ['side-question-q-before-window', 'side-question-a-before-window']);
  });
});
