import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ApiKeyItem, CreatedApiKey } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';

type ApiKeysResponse = {
  apiKeys?: ApiKeyItem[];
  success?: boolean;
  error?: string;
  apiKey?: CreatedApiKey;
};

type UseCredentialsSettingsArgs = {
  confirmDeleteApiKeyText: string;
};

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

/** Manages CloudCLI API keys (used to authenticate the external /api/agent endpoint). Git credentials are managed separately, per provider, by useGitCredentialsSection. */
export function useCredentialsSettings({
  confirmDeleteApiKeyText,
}: UseCredentialsSettingsArgs) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedApiKey | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const apiKeysResponse = await api.settings.apiKeys();
      const apiKeysPayload = await apiKeysResponse.json() as ApiKeysResponse;

      setApiKeys(apiKeysPayload.apiKeys || []);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createApiKey = useCallback(async () => {
    if (!newKeyName.trim()) {
      return;
    }

    try {
      const response = await api.settings.createApiKey(newKeyName.trim());

      const payload = await response.json() as ApiKeysResponse;
      if (!response.ok || !payload.success) {
        console.error('Error creating API key:', getApiError(payload, 'Failed to create API key'));
        return;
      }

      if (payload.apiKey) {
        setNewlyCreatedKey(payload.apiKey);
      }
      setNewKeyName('');
      setShowNewKeyForm(false);
      await fetchData();
    } catch (error) {
      console.error('Error creating API key:', error);
    }
  }, [fetchData, newKeyName]);

  const deleteApiKey = useCallback(async (keyId: string) => {
    if (!window.confirm(confirmDeleteApiKeyText)) {
      return;
    }

    try {
      const response = await api.settings.deleteApiKey(keyId);

      if (!response.ok) {
        const payload = await response.json() as ApiKeysResponse;
        console.error('Error deleting API key:', getApiError(payload, 'Failed to delete API key'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error deleting API key:', error);
    }
  }, [confirmDeleteApiKeyText, fetchData]);

  const toggleApiKey = useCallback(async (keyId: string, isActive: boolean) => {
    try {
      const response = await api.settings.toggleApiKey(keyId, !isActive);

      if (!response.ok) {
        const payload = await response.json() as ApiKeysResponse;
        console.error('Error toggling API key:', getApiError(payload, 'Failed to toggle API key'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error toggling API key:', error);
    }
  }, [fetchData]);

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(id);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, []);

  const dismissNewlyCreatedKey = useCallback(() => {
    setNewlyCreatedKey(null);
  }, []);

  const cancelNewApiKeyForm = useCallback(() => {
    setShowNewKeyForm(false);
    setNewKeyName('');
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    apiKeys,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
  };
}
