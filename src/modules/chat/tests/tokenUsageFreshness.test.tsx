import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * The composer's token counter sat at 0 for Claude sessions and only sometimes
 * flickered to a real number.
 *
 * Two writers feed it: a one-shot fetch of `/token-usage` when a session is
 * selected, and whatever the session store carries on a history page. The store
 * initialised its per-session `tokenUsage` to `null` while every consumer
 * guarded on `!== undefined`, so a provider that reports no usage on its
 * history pages was indistinguishable from one reporting zero — and each
 * history refresh pushed that zero over the fetched value.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const message: NormalizedMessage = {
  id: 'm-1',
  kind: 'text',
  role: 'assistant',
  provider: 'claude',
  sessionId: 'session-1',
  content: 'hi',
  timestamp: '2026-01-01T00:00:00.000Z',
} as NormalizedMessage;

const respondWith = (body: Record<string, unknown>) => {
  sessionMessages.mockResolvedValue({ ok: true, json: async () => ({ data: body }) });
};

beforeEach(() => {
  sessionMessages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  return renderHook(() => useSessionStore());
}

describe('token usage on a history page', () => {
  it('leaves the slot untouched when the provider reports none', async () => {
    respondWith({ messages: [message], total: 1, hasMore: false });
    const { result } = await loadStore();

    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    const slot = result.current.getSessionSlot('session-1');
    assert.equal(
      slot?.tokenUsage,
      undefined,
      'a provider that reports no usage must not look like one reporting zero',
    );
  });

  it('adopts the usage a provider does report', async () => {
    respondWith({
      messages: [message],
      total: 1,
      hasMore: false,
      tokenUsage: { used: 4183, total: 200000 },
    });
    const { result } = await loadStore();

    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    await waitFor(() => {
      assert.deepEqual(result.current.getSessionSlot('session-1')?.tokenUsage, {
        used: 4183,
        total: 200000,
      });
    });
  });
});
