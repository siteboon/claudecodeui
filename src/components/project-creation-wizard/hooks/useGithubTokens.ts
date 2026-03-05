import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchGithubTokenCredentials } from '../data/workspaceApi';
import type { GithubTokenCredential } from '../types';

type UseGithubTokensParams = {
  shouldLoad: boolean;
  selectedTokenId: string;
  onAutoSelectToken: (tokenId: string) => void;
};

export const useGithubTokens = ({
  shouldLoad,
  selectedTokenId,
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
        const activeTokens = await fetchGithubTokenCredentials();
        if (isDisposed) {
          return;
        }

        setTokens(activeTokens);
        hasLoadedRef.current = true;

        if (activeTokens.length > 0 && !selectedTokenId) {
          onAutoSelectToken(String(activeTokens[0].id));
        }
      } catch (error) {
        if (!isDisposed) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load GitHub tokens');
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
  }, [onAutoSelectToken, selectedTokenId, shouldLoad]);

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
