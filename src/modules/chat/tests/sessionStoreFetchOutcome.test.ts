import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * fetchFromServer used to hand back the session's shared slot, and its
 * callers read `slot.status` some microtasks later to tell a failure from a
 * load. By then a call queued behind it could have rewritten the status (a
 * refused one sets it back to 'idle', a new one to 'loading'), so a failed
 * request read as a loaded one.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

beforeEach(() => {
  sessionMessages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

const renderStore = async () => {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  return renderHook(() => useSessionStore());
};

test('a failed fetch reports its failure though a refused call queued behind it ran first', async () => {
  const { result } = await renderStore();
  sessionMessages.mockRejectedValueOnce(new Error('offline'));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  let outcomes: unknown[] = [];
  await act(async () => {
    const failing = result.current.fetchFromServer('session-1', { limit: null, offset: 0 });
    const refused = result.current.fetchFromServer('session-1', { limit: null, offset: 0, canRequest: () => false });
    outcomes = await Promise.all([failing, refused]);
  });

  const [failing, refused] = outcomes as [{ ok: boolean } | null, unknown];
  assert.equal(failing?.ok, false);
  assert.equal(refused, null);
});

test('a fetch that loaded reports success with the page it loaded', async () => {
  const { result } = await renderStore();
  const messages = [
    { id: 'm-1', kind: 'text', role: 'user', content: 'one', sessionId: 'session-1', provider: 'claude', timestamp: '2026-01-01T00:00:01.000Z' },
    { id: 'm-2', kind: 'text', role: 'assistant', content: 'two', sessionId: 'session-1', provider: 'claude', timestamp: '2026-01-01T00:00:02.000Z' },
  ];
  sessionMessages.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { messages, total: 42, hasMore: true } }),
  });

  let outcome: { slot: { total: number; offset: number; hasMore: boolean }; ok: boolean } | null = null;
  await act(async () => {
    outcome = await result.current.fetchFromServer('session-1', { limit: 2, offset: 0 });
  });

  assert.equal(outcome!.ok, true);
  assert.equal(outcome!.slot.total, 42);
  assert.equal(outcome!.slot.offset, 2);
  assert.equal(outcome!.slot.hasMore, true);
});
