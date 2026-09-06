import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchGitTokenCredentials } from '@/modules/project-creation-wizard/utils/workspaceApi';
import type { GitTokenCredential } from '@/shared/types';

type UseGitTokensParams = {
  shouldLoad: boolean;
  credentialType: string;
  selectedTokenId: string;
  onAutoSelectToken: (tokenId: string) => void;
};

/** Loads stored token credentials of one type (e.g. 'github_token'), reloading when credentialType changes (the user switched providers). */
export const useGitTokens = ({
  shouldLoad,
  credentialType,
  selectedTokenId,
  onAutoSelectToken,
}: UseGitTokensParams) => {
  const [tokens, setTokens] = useState<GitTokenCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedForTypeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldLoad) {
      if (loadedForTypeRef.current !== null) {
        loadedForTypeRef.current = null;
        setTokens([]);
        setLoadError(null);
        setLoading(false);
      }
      return;
    }

    if (loadedForTypeRef.current === credentialType) {
      return;
    }

    let isDisposed = false;

    const loadTokens = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const activeTokens = await fetchGitTokenCredentials(credentialType);
        if (isDisposed) {
          return;
        }

        setTokens(activeTokens);
        loadedForTypeRef.current = credentialType;

        if (activeTokens.length > 0 && !selectedTokenId) {
          onAutoSelectToken(String(activeTokens[0].id));
        }
      } catch (error) {
        if (!isDisposed) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load stored tokens');
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
  }, [credentialType, onAutoSelectToken, selectedTokenId, shouldLoad]);

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
