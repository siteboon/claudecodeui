import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

/**
 * A failed repository scan must not read as "no nested repositories": that
 * would offer "git init" on the project root. It stays unsettled and is retried.
 */
const replies: Array<() => Response> = [];

vi.mock('@/shared/api', () => ({
  api: {
    git: {
      repositories: async () => (replies.shift() ?? (() => new Response('{}', { status: 500 })))(),
    },
  },
}));

const { useGitRepositories } = await import('@/modules/git-panel/hooks/useGitRepositories');

afterEach(() => {
  vi.useRealTimers();
  replies.length = 0;
});

test('a failed scan keeps the scan unsettled, then a retry settles it', async () => {
  vi.useFakeTimers();
  replies.push(
    () => new Response('{"error":"boom"}', { status: 500 }),
    () => new Response(JSON.stringify({ repositories: [{ path: 'firmware', name: 'firmware' }] }), { status: 200 }),
  );
  const { result } = renderHook(() => useGitRepositories({ projectId: 'p1' } as never));

  await act(async () => { await vi.runOnlyPendingTimersAsync(); });
  expect(result.current.isRepositoryScanComplete).toBe(false);
  expect(result.current.repositories).toEqual([]);

  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(result.current.isRepositoryScanComplete).toBe(true);
  expect(result.current.repositories.map((repository) => repository.path)).toEqual(['firmware']);
});
