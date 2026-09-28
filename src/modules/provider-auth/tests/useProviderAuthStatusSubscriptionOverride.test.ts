import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useProviderAuthStatus } from '@/modules/provider-auth/hooks/useProviderAuthStatus';

// Issue #568: the server reports `subscriptionOverride` on the Claude auth
// status when an API key is bypassing a valid `claude /login` subscription. The
// hook rebuilds the status object field by field, so this pins down that the
// field survives the trip — and stays absent when the server omits it.

const payloads: Record<string, unknown> = {};

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      authStatus: async (provider: string) => new Response(
        JSON.stringify({ success: true, data: payloads[provider] ?? {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    },
  },
}));

describe('useProviderAuthStatus subscription override', () => {
  it('keeps the override the server reports for Claude', async () => {
    payloads.claude = {
      installed: true,
      provider: 'claude',
      authenticated: true,
      email: 'API Key Auth',
      method: 'api_key',
      subscriptionOverride: { variable: 'ANTHROPIC_API_KEY', source: 'process_env', subscriptionEmail: null },
    };

    const { result } = renderHook(() => useProviderAuthStatus({ initialLoading: false }));
    await act(async () => {
      await result.current.checkProviderAuthStatus('claude');
    });

    expect(result.current.providerAuthStatus.claude).toEqual({
      authenticated: true,
      email: 'API Key Auth',
      method: 'api_key',
      error: null,
      loading: false,
      subscriptionOverride: { variable: 'ANTHROPIC_API_KEY', source: 'process_env', subscriptionEmail: null },
    });
  });

  it('leaves the field out when the server does not send one', async () => {
    payloads.claude = {
      installed: true,
      provider: 'claude',
      authenticated: true,
      email: 'someone@example.com',
      method: 'credentials_file',
    };

    const { result } = renderHook(() => useProviderAuthStatus({ initialLoading: false }));
    await act(async () => {
      await result.current.checkProviderAuthStatus('claude');
    });

    expect(result.current.providerAuthStatus.claude).toEqual({
      authenticated: true,
      email: 'someone@example.com',
      method: 'credentials_file',
      error: null,
      loading: false,
    });
    expect('subscriptionOverride' in result.current.providerAuthStatus.claude).toBe(false);
  });
});
