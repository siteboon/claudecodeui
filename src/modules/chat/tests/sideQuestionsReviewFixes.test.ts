import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { sideQuestionStore, useAskSideQuestion } from '@/modules/chat/hooks/useSideQuestions';
import type { SideQuestionEvent } from '@/shared/types';

/**
 * Three review fixes in `useSideQuestions.ts`:
 *
 * - `useAskSideQuestion` takes an `isConnected` argument (default true); while
 *   disconnected it sends nothing, stores nothing, and returns false.
 * - The id it generates when `crypto.randomUUID` is unavailable falls back to
 *   `local_<ts>_<rand>`, which still matches the server's id pattern.
 * - `sideQuestionStore.applyEvent` removes the row on a `phase: 'dismissed'`
 *   event.
 */

// Each test asks or begins under its own session id: `replaceForSession([])`
// keeps any `running` local entry (by design, for a history refresh that
// raced an ask), so it cannot clear a previous test's optimistic row — a
// fresh session id sidesteps that rather than fighting it.
let sessionCounter = 0;
const freshSessionId = (): string => `session-review-fixes-${++sessionCounter}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

test('useAskSideQuestion refuses when disconnected: no frame sent, no optimistic entry, returns false', () => {
  const SESSION_ID = freshSessionId();
  const sendMessage = vi.fn();
  const { result } = renderHook(() => useAskSideQuestion(sendMessage));

  let returned: boolean | undefined;
  act(() => {
    returned = result.current(SESSION_ID, 'are we connected?', undefined, false);
  });

  assert.equal(returned, false, 'the ask is refused');
  assert.equal(sendMessage.mock.calls.length, 0, 'no chat.side_question frame is sent');
  assert.deepEqual(sideQuestionStore.forSession(SESSION_ID), [], 'nothing optimistic is stored');
});

test('useAskSideQuestion falls back to a local_<ts>_<rand> id when crypto.randomUUID is unavailable', () => {
  const SESSION_ID = freshSessionId();
  const originalRandomUUID = crypto.randomUUID;
  // `randomUUID` lives on crypto's prototype, so `delete crypto.randomUUID` is
  // a no-op; shadow it with an own, undefined property instead, the same
  // shape a browser without it (plain http://) presents.
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });

  try {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useAskSideQuestion(sendMessage));

    act(() => {
      result.current(SESSION_ID, 'what id do we get?', undefined, true);
    });

    assert.equal(sendMessage.mock.calls.length, 1, 'the frame is still sent');
    const frame = sendMessage.mock.calls[0]?.[0] as { sideQuestionId?: string };
    assert.match(frame.sideQuestionId ?? '', /^[A-Za-z0-9_-]{1,100}$/, 'the fallback id matches the server pattern');
    assert.match(frame.sideQuestionId ?? '', /^local_/, 'and is drawn from the local_ fallback, not crypto.randomUUID');
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: originalRandomUUID, configurable: true });
  }
});

test('applyEvent with phase "dismissed" removes the row from the store', () => {
  const SESSION_ID = freshSessionId();
  sideQuestionStore.begin({ id: 'sq-1', sessionId: SESSION_ID, question: 'will this survive?', createdAt: '2026-10-26T10:00:00.000Z' });
  assert.equal(sideQuestionStore.forSession(SESSION_ID).length, 1, 'the row exists before the event');

  const dismissed: SideQuestionEvent = {
    kind: 'side_question',
    sessionId: SESSION_ID,
    sideQuestionId: 'sq-1',
    phase: 'dismissed',
    timestamp: '2026-10-26T10:00:05.000Z',
  };
  act(() => {
    sideQuestionStore.applyEvent(dismissed);
  });

  assert.equal(sideQuestionStore.forSession(SESSION_ID).length, 0, 'the row is gone');
});
