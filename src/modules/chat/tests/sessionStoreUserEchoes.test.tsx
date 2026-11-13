import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage } from '@/shared/types';

const sessionMessages = vi.fn();
vi.mock('@/shared/api', () => ({
  api: { providers: { sessionMessages: (...args: unknown[]) => sessionMessages(...args) } },
}));

const row = (id: string, seconds: number, content = 'continue the previous task'): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  provider: 'antigravity',
  kind: 'text',
  role: 'user',
  content,
  timestamp: new Date(Date.UTC(2026, 9, 31, 13, 14, seconds)).toISOString(),
});

function history(messages: NormalizedMessage[]) {
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages, total: messages.length, hasMore: false } }),
  });
}

beforeEach(() => {
  sessionMessages.mockReset();
});

test.each([false, true])('reconciles a streamed user row before history refresh (cached history: %s)', async (cached) => {
  const { result } = renderHook(() => useSessionStore());
  const previous = row('previous', 0, 'earlier request');
  if (cached) {
    history([previous]);
    await act(async () => { await result.current.fetchFromServer('session-1'); });
  }

  const local = row('local_prompt', 17);
  const persisted = row('session-1-219', 22);
  act(() => { result.current.appendRealtime('session-1', local); });
  assert.equal(result.current.getMessages('session-1').at(-1)?.id, local.id);

  act(() => { result.current.appendRealtime('session-1', persisted); });
  assert.deepEqual(result.current.getMessages('session-1'), cached ? [previous, persisted] : [persisted]);

  history(cached ? [previous, persisted] : [persisted]);
  await act(async () => { await result.current.refreshLatestFromServer('session-1'); });
  assert.deepEqual(result.current.getMessages('session-1'), cached ? [previous, persisted] : [persisted]);
});

test('keeps a repeated send until it has its own persisted user row', async () => {
  const { result } = renderHook(() => useSessionStore());
  const persisted = row('session-1-219', 22);
  history([persisted]);
  await act(async () => { await result.current.fetchFromServer('session-1'); });

  const secondLocal = row('local_second', 30);
  act(() => {
    result.current.appendRealtime('session-1', row('local_first', 17));
    // The same native row also appears in the realtime stream: it must only
    // retire one local echo across history and realtime.
    result.current.appendRealtime('session-1', persisted);
    result.current.appendRealtime('session-1', secondLocal);
  });
  assert.deepEqual(result.current.getMessages('session-1'), [persisted, secondLocal]);

  const secondPersisted = row('session-1-220', 33);
  act(() => { result.current.appendRealtime('session-1', secondPersisted); });
  assert.deepEqual(result.current.getMessages('session-1'), [persisted, secondPersisted]);
});

test('keeps an edited echo when only the retained matching user row is available', async () => {
  const { result } = renderHook(() => useSessionStore());
  const retained = row('session-1-1', 21);
  history([retained]);
  await act(async () => { await result.current.fetchFromServer('session-1'); });

  const edited = { ...row('local_edit', 20), replacesAfterRowCount: 1, replacesAnchorId: 'replaced' };
  act(() => {
    result.current.appendRealtime('session-1', retained);
    result.current.appendRealtime('session-1', edited);
  });
  assert.equal(result.current.getMessages('session-1').length, 2);

  const replacement = row('session-1-2', 25);
  act(() => { result.current.appendRealtime('session-1', replacement); });
  assert.deepEqual(result.current.getMessages('session-1'), [retained, replacement]);
});
