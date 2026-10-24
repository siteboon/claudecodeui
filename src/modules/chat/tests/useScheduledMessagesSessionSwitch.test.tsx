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

// Session switching is about the initial fetch; nothing is announced here.
const subscribe = () => () => {};

afterEach(() => {
  vi.restoreAllMocks();
});

test('switching sessions clears the previous session\'s scheduled messages immediately', async () => {
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(async (sessionId?: string) =>
    listResponse(sessionId === 'session-a' ? [MESSAGE_A] : []));

  const { result, rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId, subscribe), {
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

  const { result, rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId, subscribe), {
    initialProps: { sessionId: 'session-a' },
  });
  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.ok(releaseSessionA));

  await act(async () => {
    releaseSessionA?.();
  });

  assert.equal(result.current.scheduledMessages.length, 0);
});

test('a slow fetch for the previous session cannot land after switching to no session', async () => {
  // Leaving for no session sends no request of its own, so nothing newer
  // supersedes A's request: only the active-session check can drop it.
  let releaseSessionA: (() => void) | undefined;
  vi.spyOn(api.scheduledMessages, 'list').mockImplementation(() => new Promise<Response>((resolve) => {
    releaseSessionA = () => resolve(listResponse([MESSAGE_A]));
  }));

  const { result, rerender } = renderHook(({ sessionId }) => useScheduledMessages(sessionId, subscribe), {
    initialProps: { sessionId: 'session-a' as string | null },
  });
  await waitFor(() => assert.ok(releaseSessionA));
  rerender({ sessionId: null });

  await act(async () => {
    releaseSessionA?.();
  });

  assert.equal(result.current.scheduledMessages.length, 0);
});
