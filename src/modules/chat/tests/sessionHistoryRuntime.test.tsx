import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test, vi } from 'vitest';

import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { readUserPreference } from '@/shared/userSettings';

const sessionMessages = vi.hoisted(() => vi.fn());

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionMessages } },
}));
vi.mock('@/shared/userSettings', () => ({ readUserPreference: vi.fn() }));

test('history requests use the current Codex preference on every page', async () => {
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: [], total: 0, hasMore: false } }),
  });
  const { result } = renderHook(() => useSessionStore());

  for (const runtimeMode of ['sdk', 'app-server', undefined]) {
    vi.mocked(readUserPreference).mockReturnValue({ runtimeMode });
    await act(async () => {
      await result.current.fetchFromServer(`session-${runtimeMode}`, { limit: 20, offset: 0 });
    });
    assert.deepEqual(sessionMessages.mock.lastCall?.slice(0, 2), [
      `session-${runtimeMode}`,
      { limit: 20, offset: 0, codexRuntimeMode: runtimeMode ?? 'app-server' },
    ]);
    assert.equal(vi.mocked(readUserPreference).mock.lastCall?.[0], 'codexPermissions');
  }
});
