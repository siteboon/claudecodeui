import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchGithubTokenCredentials } from '../data/workspaceApi';
import type { CredentialType, GithubTokenCredential } from '../types';

type UseGithubTokensParams = {
  shouldLoad: boolean;
  credentialType?: CredentialType;
  selectedTokenId: string;
  preferredHost?: string | null;
  autoSelectFirst?: boolean;
  onAutoSelectToken: (tokenId: string) => void;
};

export const useGithubTokens = ({
  shouldLoad,
  credentialType = 'github_token',
  selectedTokenId,
  preferredHost = null,
  autoSelectFirst = true,
  onAutoSelectToken,
}: UseGithubTokensParams) => {
  const [tokens, setTokens] = useState<GithubTokenCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!shouldLoad || hasLoadedRef.current) {
      return;
    }

    let isDisposed = false;

    const loadTokens = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const activeTokens = await fetchGithubTokenCredentials(credentialType);
        if (isDisposed) {
          return;
        }

        setTokens(activeTokens);
        hasLoadedRef.current = true;

        if (activeTokens.length > 0 && !selectedTokenId) {
          const preferredToken = preferredHost
            ? activeTokens.find((token) => token.credential_host?.toLowerCase() === preferredHost.toLowerCase())
            : null;
          if (preferredToken) {
            onAutoSelectToken(String(preferredToken.id));
          } else if (autoSelectFirst) {
            onAutoSelectToken(String(activeTokens[0].id));
          }
        }
      } catch (error) {
        if (!isDisposed) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load repository tokens');
        }
      } finally {
        if (!isDisposed) {
          setLoading(false);
        }
      }
    };

    loadTokens();

    return () => {
      isDisposed = true;
    };
  }, [autoSelectFirst, credentialType, onAutoSelectToken, preferredHost, selectedTokenId, shouldLoad]);

  const selectedTokenName = useMemo(
    () => tokens.find((token) => String(token.id) === selectedTokenId)?.credential_name || null,
    [selectedTokenId, tokens],
  );

  return {
    tokens,
    loading,
    loadError,
    selectedTokenName,
  };
};
