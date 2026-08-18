import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type {
  ApiKeyItem,
  ApiKeysResponse,
  CreatedApiKey,
  GithubCredentialItem,
  GithubCredentialsResponse,
} from '../view/tabs/api-settings/types';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { getApiErrorMessage } from '../../../utils/apiError';
import type { ApiErrorPayload } from '../../../utils/apiError';

type UseCredentialsSettingsArgs = {
  confirmDeleteApiKeyText: string;
  confirmDeleteGithubCredentialText: string;
};

const getApiError = getApiErrorMessage;

export type GithubTokenCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; login: string; scopes: string[] }
  | { status: 'invalid'; message: string };

type VerifyTokenResponse = ApiErrorPayload & { login?: string; scopes?: string[] };

export function useCredentialsSettings({
  confirmDeleteApiKeyText,
  confirmDeleteGithubCredentialText,
}: UseCredentialsSettingsArgs) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [githubCredentials, setGithubCredentials] = useState<GithubCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  const [showNewGithubForm, setShowNewGithubForm] = useState(false);
  const [newGithubName, setNewGithubName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [newGithubDescription, setNewGithubDescription] = useState('');

  // Result of checking the pasted token against GitHub before storing it.
  const [githubTokenCheck, setGithubTokenCheck] = useState<GithubTokenCheck>({ status: 'idle' });
  // Identifies the verification a response belongs to. A check is a network
  // round trip the user can outrun by editing the token or closing the form;
  // without this, a late reply would paint a verdict for a token that is no
  // longer in the field. Bumping it abandons whatever is in flight.
  const verificationRequestId = useRef(0);

  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedApiKey | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [apiKeysResponse, credentialsResponse] = await Promise.all([
        authenticatedFetch('/api/settings/api-keys'),
        authenticatedFetch('/api/settings/credentials?type=github_token'),
      ]);

      const [apiKeysPayload, credentialsPayload] = await Promise.all([
        apiKeysResponse.json() as Promise<ApiKeysResponse>,
        credentialsResponse.json() as Promise<GithubCredentialsResponse>,
      ]);

      setApiKeys(apiKeysPayload.apiKeys || []);
      setGithubCredentials(credentialsPayload.credentials || []);
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

  /**
   * Asks the server to authenticate the pasted token against GitHub.
   * Returns true when GitHub accepts it, so callers can gate on the result.
   */
  const verifyGithubToken = useCallback(async (): Promise<boolean> => {
    const token = newGithubToken.trim();
    if (!token) {
      setGithubTokenCheck({ status: 'invalid', message: 'Enter a token first' });
      return false;
    }

    verificationRequestId.current += 1;
    const requestId = verificationRequestId.current;
    const isCurrentRequest = () => verificationRequestId.current === requestId;

    setGithubTokenCheck({ status: 'checking' });

    try {
      const response = await authenticatedFetch('/api/github/verify-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      const payload = await response.json() as VerifyTokenResponse;

      if (!isCurrentRequest()) {
        return false;
      }

      if (!response.ok || !payload.login) {
        setGithubTokenCheck({
          status: 'invalid',
          message: getApiError(payload, 'GitHub rejected this token'),
        });
        return false;
      }

      setGithubTokenCheck({
        status: 'valid',
        login: payload.login,
        scopes: payload.scopes ?? [],
      });
      return true;
    } catch (error) {
      if (!isCurrentRequest()) {
        return false;
      }

      setGithubTokenCheck({
        status: 'invalid',
        message: error instanceof Error ? error.message : 'Could not reach the server',
      });
      return false;
    }
  }, [newGithubToken]);

  const createGithubCredential = useCallback(async () => {
    if (!newGithubName.trim() || !newGithubToken.trim()) {
      return;
    }

    // Storing a token GitHub already refuses only defers the failure to the
    // repo picker, where it surfaces as a confusing empty list.
    if (!(await verifyGithubToken())) {
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
      setGithubTokenCheck({ status: 'idle' });
      setShowNewGithubForm(false);
      setShowToken((prev) => ({ ...prev, new: false }));
      await fetchData();
    } catch (error) {
      console.error('Error creating GitHub credential:', error);
    }
  }, [fetchData, newGithubDescription, newGithubName, newGithubToken, verifyGithubToken]);

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
    verificationRequestId.current += 1;
    setShowNewGithubForm(false);
    setNewGithubName('');
    setNewGithubToken('');
    setNewGithubDescription('');
    setGithubTokenCheck({ status: 'idle' });
    setShowToken((prev) => ({ ...prev, new: false }));
  }, []);

  const changeNewGithubToken = useCallback((token: string) => {
    verificationRequestId.current += 1;
    setNewGithubToken(token);
    setGithubTokenCheck({ status: 'idle' });
  }, []);

  const toggleNewGithubTokenVisibility = useCallback(() => {
    setShowToken((prev) => ({ ...prev, new: !prev.new }));
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    apiKeys,
    githubCredentials,
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
    setNewGithubToken: changeNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    githubTokenCheck,
    verifyGithubToken,
    deleteGithubCredential,
    toggleGithubCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    toggleNewGithubTokenVisibility,
  };
}
