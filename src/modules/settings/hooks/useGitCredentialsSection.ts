import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { GitCredentialItem, GitProvider } from '@/shared/types';

type GitCredentialsResponse = {
  credentials?: GitCredentialItem[];
  success?: boolean;
  error?: string;
};

type UseGitCredentialsSectionArgs = {
  provider: GitProvider;
  confirmDeleteText: string;
};

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

/** Manages one provider's stored git credentials (list, create, delete, toggle). One instance per provider, rendered by CredentialsSettingsTab. */
export function useGitCredentialsSection({ provider, confirmDeleteText }: UseGitCredentialsSectionArgs) {
  const credentialType = `${provider}_token`;

  const [credentials, setCredentials] = useState<GitCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [showTokenPlainText, setShowTokenPlainText] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await api.settings.credentials(credentialType);
      const payload = await response.json() as GitCredentialsResponse;

      if (!response.ok) {
        setLoadError(getApiError(payload, `Failed to load ${provider} credentials`));
        return;
      }

      setCredentials(payload.credentials || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : `Failed to load ${provider} credentials`);
    } finally {
      setLoading(false);
    }
  }, [credentialType, provider]);

  const createCredential = useCallback(async () => {
    if (!newName.trim() || !newToken.trim()) {
      return;
    }

    try {
      const response = await api.settings.createCredential({
        credentialName: newName.trim(),
        credentialType,
        credentialValue: newToken,
        description: newDescription.trim(),
      });

      const payload = await response.json() as GitCredentialsResponse;
      if (!response.ok || !payload.success) {
        console.error(`Error creating ${provider} credential:`, getApiError(payload, `Failed to create ${provider} credential`));
        return;
      }

      setNewName('');
      setNewToken('');
      setNewDescription('');
      setShowNewForm(false);
      setShowTokenPlainText(false);
      await fetchData();
    } catch (error) {
      console.error(`Error creating ${provider} credential:`, error);
    }
  }, [credentialType, fetchData, newDescription, newName, newToken, provider]);

  const deleteCredential = useCallback(async (credentialId: string) => {
    if (!window.confirm(confirmDeleteText)) {
      return;
    }

    try {
      const response = await api.settings.deleteCredential(credentialId);

      if (!response.ok) {
        const payload = await response.json() as GitCredentialsResponse;
        console.error(`Error deleting ${provider} credential:`, getApiError(payload, `Failed to delete ${provider} credential`));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error(`Error deleting ${provider} credential:`, error);
    }
  }, [confirmDeleteText, fetchData, provider]);

  const toggleCredential = useCallback(async (credentialId: string, isActive: boolean) => {
    try {
      const response = await api.settings.toggleCredential(credentialId, !isActive);

      if (!response.ok) {
        const payload = await response.json() as GitCredentialsResponse;
        console.error(`Error toggling ${provider} credential:`, getApiError(payload, `Failed to toggle ${provider} credential`));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error(`Error toggling ${provider} credential:`, error);
    }
  }, [fetchData, provider]);

  const cancelNewForm = useCallback(() => {
    setShowNewForm(false);
    setNewName('');
    setNewToken('');
    setNewDescription('');
    setShowTokenPlainText(false);
  }, []);

  const toggleNewTokenVisibility = useCallback(() => {
    setShowTokenPlainText((previous) => !previous);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    credentials,
    loading,
    loadError,
    showNewForm,
    setShowNewForm,
    newName,
    setNewName,
    newToken,
    setNewToken,
    newDescription,
    setNewDescription,
    showTokenPlainText,
    createCredential,
    deleteCredential,
    toggleCredential,
    cancelNewForm,
    toggleNewTokenVisibility,
  };
}
