import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { api } from '@/shared/api';
import { useScheduledMessages } from '@/modules/chat/composer/useScheduledMessages';

function listResponse(data: unknown[]): Response {
  return { json: async () => ({ data }) } as unknown as Response;
}

const MESSAGE_A = {
  id: 'sm-a',
  sessionId: 'session-a',
  content: 'from session a',
  scheduledFor: '2026-08-28T12:00:00.000Z',
  status: 'pending',
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('switching sessions clears the previous session\'s scheduled messages immediately', async () => {
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async (sessionId?: string) =>
    listResponse(sessionId === 'session-a' ? [MESSAGE_A] : []));

  const { result, rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId), {
    initialProps: { sessionId: 'session-a' },
  });
  await waitFor(() => assert.equal(result.current.scheduledMessages.length, 1));

  rerender({ sessionId: 'session-b' });

  // The banner must not linger with session A's message while B's list loads.
  assert.equal(result.current.scheduledMessages.length, 0);
});

test('a slow fetch for the previous session cannot land on the next one', async () => {
  let releaseSessionA: (() => void) | undefined;
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation((sessionId?: string) => {
    if (sessionId === 'session-a') {
      return new Promise<Response>((resolve) => {
        releaseSessionA = () => resolve(listResponse([MESSAGE_A]));
      });
    }
    return Promise.resolve(listResponse([]));
  });

  const { result, rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId), {
    initialProps: { sessionId: 'session-a' },
  });
  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.ok(releaseSessionA));

  await act(async () => {
    releaseSessionA?.();
  });

  assert.equal(result.current.scheduledMessages.length, 0);
});
