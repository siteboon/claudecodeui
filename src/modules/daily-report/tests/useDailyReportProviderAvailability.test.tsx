import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

const { authStatus } = vi.hoisted(() => ({ authStatus: vi.fn() }));

vi.mock('@/shared/api', () => ({
  api: { providers: { authStatus } },
  readApiJson: async (response: Response) => response.json(),
}));

const { useDailyReportProviderAvailability } = await import(
  '@/modules/daily-report/hooks/useDailyReport'
);

test('reports only installed and authenticated summary providers as available', async () => {
  authStatus.mockImplementation(async (provider: 'claude' | 'codex') => new Response(JSON.stringify({
    success: true,
    data: {
      installed: true,
      authenticated: provider === 'codex',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const { result } = renderHook(() => useDailyReportProviderAvailability(true));
  await waitFor(() => assert.equal(result.current.isCheckingProviders, false));

  assert.deepEqual(result.current.availableProviders, ['codex']);
  assert.deepEqual(authStatus.mock.calls.map(([provider]) => provider), ['claude', 'codex']);
});
