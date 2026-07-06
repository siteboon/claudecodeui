import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type {
  ApiKeyItem,
  ApiKeysResponse,
  CreatedApiKey,
  GithubCredentialItem,
  GithubCredentialsResponse,
} from '../view/tabs/api-settings/types';
import { copyTextToClipboard } from '../../../utils/clipboard';

type UseCredentialsSettingsArgs = {
  confirmDeleteApiKeyText: string;
  confirmDeleteGithubCredentialText: string;
  confirmDeleteGitlabCredentialText: string;
};

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

export function useCredentialsSettings({
  confirmDeleteApiKeyText,
  confirmDeleteGithubCredentialText,
  confirmDeleteGitlabCredentialText,
}: UseCredentialsSettingsArgs) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [githubCredentials, setGithubCredentials] = useState<GithubCredentialItem[]>([]);
  const [gitlabCredentials, setGitlabCredentials] = useState<GithubCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  const [showNewGithubForm, setShowNewGithubForm] = useState(false);
  const [newGithubName, setNewGithubName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [newGithubDescription, setNewGithubDescription] = useState('');
  const [showNewGitlabForm, setShowNewGitlabForm] = useState(false);
  const [newGitlabName, setNewGitlabName] = useState('');
  const [newGitlabHost, setNewGitlabHost] = useState('');
  const [newGitlabToken, setNewGitlabToken] = useState('');
  const [newGitlabDescription, setNewGitlabDescription] = useState('');

  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedApiKey | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [apiKeysResponse, credentialsResponse, gitlabCredentialsResponse] = await Promise.all([
        authenticatedFetch('/api/settings/api-keys'),
        authenticatedFetch('/api/settings/credentials?type=github_token'),
        authenticatedFetch('/api/settings/credentials?type=gitlab_token'),
      ]);

      const [apiKeysPayload, credentialsPayload, gitlabCredentialsPayload] = await Promise.all([
        apiKeysResponse.json() as Promise<ApiKeysResponse>,
        credentialsResponse.json() as Promise<GithubCredentialsResponse>,
        gitlabCredentialsResponse.json() as Promise<GithubCredentialsResponse>,
      ]);

      setApiKeys(apiKeysPayload.apiKeys || []);
      setGithubCredentials(credentialsPayload.credentials || []);
      setGitlabCredentials(gitlabCredentialsPayload.credentials || []);
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
      const response = await authenticatedFetch('/api/settings/api-keys', {
        method: 'POST',
        body: JSON.stringify({ keyName: newKeyName.trim() }),
      });

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
      const response = await authenticatedFetch(`/api/settings/api-keys/${keyId}`, {
        method: 'DELETE',
      });

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
      const response = await authenticatedFetch(`/api/settings/api-keys/${keyId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });

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

  const createGithubCredential = useCallback(async () => {
    if (!newGithubName.trim() || !newGithubToken.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newGithubName.trim(),
          credentialType: 'github_token',
          credentialValue: newGithubToken,
          description: newGithubDescription.trim(),
        }),
      });

      const payload = await response.json() as GithubCredentialsResponse;
      if (!response.ok || !payload.success) {
        console.error('Error creating GitHub credential:', getApiError(payload, 'Failed to create GitHub credential'));
        return;
      }

      setNewGithubName('');
      setNewGithubToken('');
      setNewGithubDescription('');
      setShowNewGithubForm(false);
      setShowToken((prev) => ({ ...prev, new: false }));
      await fetchData();
    } catch (error) {
      console.error('Error creating GitHub credential:', error);
    }
  }, [fetchData, newGithubDescription, newGithubName, newGithubToken]);

  const createGitlabCredential = useCallback(async () => {
    if (!newGitlabName.trim() || !newGitlabHost.trim() || !newGitlabToken.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newGitlabName.trim(),
          credentialType: 'gitlab_token',
          credentialValue: newGitlabToken,
          credentialHost: newGitlabHost.trim().toLowerCase(),
          description: newGitlabDescription.trim(),
        }),
      });

      const payload = await response.json() as GithubCredentialsResponse;
      if (!response.ok || !payload.success) {
        console.error('Error creating GitLab credential:', getApiError(payload, 'Failed to create GitLab credential'));
        return;
      }

      setNewGitlabName('');
      setNewGitlabHost('');
      setNewGitlabToken('');
      setNewGitlabDescription('');
      setShowNewGitlabForm(false);
      setShowToken((prev) => ({ ...prev, newGitlab: false }));
      await fetchData();
    } catch (error) {
      console.error('Error creating GitLab credential:', error);
    }
  }, [fetchData, newGitlabDescription, newGitlabHost, newGitlabName, newGitlabToken]);

  const deleteGithubCredential = useCallback(async (credentialId: string) => {
    if (!window.confirm(confirmDeleteGithubCredentialText)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        console.error('Error deleting GitHub credential:', getApiError(payload, 'Failed to delete GitHub credential'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error deleting GitHub credential:', error);
    }
  }, [confirmDeleteGithubCredentialText, fetchData]);

  const deleteGitlabCredential = useCallback(async (credentialId: string) => {
    if (!window.confirm(confirmDeleteGitlabCredentialText)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        console.error('Error deleting GitLab credential:', getApiError(payload, 'Failed to delete GitLab credential'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error deleting GitLab credential:', error);
    }
  }, [confirmDeleteGitlabCredentialText, fetchData]);

  const toggleGithubCredential = useCallback(async (credentialId: string, isActive: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        console.error('Error toggling GitHub credential:', getApiError(payload, 'Failed to toggle GitHub credential'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error toggling GitHub credential:', error);
    }
  }, [fetchData]);

  const toggleGitlabCredential = useCallback(async (credentialId: string, isActive: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        console.error('Error toggling GitLab credential:', getApiError(payload, 'Failed to toggle GitLab credential'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error toggling GitLab credential:', error);
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

  const cancelNewGithubForm = useCallback(() => {
    setShowNewGithubForm(false);
    setNewGithubName('');
    setNewGithubToken('');
    setNewGithubDescription('');
    setShowToken((prev) => ({ ...prev, new: false }));
  }, []);

  const cancelNewGitlabForm = useCallback(() => {
    setShowNewGitlabForm(false);
    setNewGitlabName('');
    setNewGitlabHost('');
    setNewGitlabToken('');
    setNewGitlabDescription('');
    setShowToken((prev) => ({ ...prev, newGitlab: false }));
  }, []);

  const toggleNewGithubTokenVisibility = useCallback(() => {
    setShowToken((prev) => ({ ...prev, new: !prev.new }));
  }, []);

  const toggleNewGitlabTokenVisibility = useCallback(() => {
    setShowToken((prev) => ({ ...prev, newGitlab: !prev.newGitlab }));
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    apiKeys,
    githubCredentials,
    gitlabCredentials,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showNewGitlabForm,
    setShowNewGitlabForm,
    newGitlabName,
    setNewGitlabName,
    newGitlabHost,
    setNewGitlabHost,
    newGitlabToken,
    setNewGitlabToken,
    newGitlabDescription,
    setNewGitlabDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    createGitlabCredential,
    deleteGithubCredential,
    deleteGitlabCredential,
    toggleGithubCredential,
    toggleGitlabCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    cancelNewGitlabForm,
    toggleNewGithubTokenVisibility,
    toggleNewGitlabTokenVisibility,
  };
}
