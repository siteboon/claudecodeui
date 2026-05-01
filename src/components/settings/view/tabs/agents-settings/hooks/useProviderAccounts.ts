import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../../../../utils/api';
import type { AgentProvider } from '../../../../types/types';

export type ProviderAccount = {
  id: number;
  provider: string;
  account_name: string;
  auth_method: string;
  email: string | null;
  is_active: number;
  created_at: string;
};

export function useProviderAccounts(provider: AgentProvider) {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/providers/${provider}/accounts`);
      if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
      const json = await res.json();
      setAccounts(json.data?.accounts ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const addAccount = useCallback(
    async (accountName: string, credentialValue: string, email?: string) => {
      const res = await authenticatedFetch(`/api/providers/${provider}/accounts`, {
        method: 'POST',
        body: JSON.stringify({ accountName, authMethod: 'api_key', credentialValue, email: email || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `Failed to add account (${res.status})`);
      }
      await fetchAccounts();
    },
    [provider, fetchAccounts],
  );

  const activateAccount = useCallback(
    async (accountId: number) => {
      const res = await authenticatedFetch(`/api/providers/${provider}/accounts/${accountId}/activate`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error(`Failed to activate account (${res.status})`);
      await fetchAccounts();
    },
    [provider, fetchAccounts],
  );

  const removeAccount = useCallback(
    async (accountId: number) => {
      const res = await authenticatedFetch(`/api/providers/${provider}/accounts/${accountId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to remove account (${res.status})`);
      await fetchAccounts();
    },
    [provider, fetchAccounts],
  );

  return { accounts, loading, error, addAccount, activateAccount, removeAccount, refetch: fetchAccounts };
}
