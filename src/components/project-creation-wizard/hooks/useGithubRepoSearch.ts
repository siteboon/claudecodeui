import { useEffect, useState } from 'react';
import { searchGithubRepositories } from '../data/workspaceApi';
import type { GithubRepoSummary } from '../types';

type UseGithubRepoSearchParams = {
  tokenId: string;
  query: string;
  enabled: boolean;
};

export const useGithubRepoSearch = ({ tokenId, query, enabled }: UseGithubRepoSearchParams) => {
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !tokenId) {
      setRepos([]);
      setLoading(false);
      setError(null);
      return;
    }

    let isDisposed = false;
    // Network + GitHub API round trip, so keystrokes get a real debounce;
    // an empty query still fires (no delay) to show recent repos on open.
    const debounceMs = query.trim() ? 300 : 0;

    // Enter the loading state now, not when the timer fires. The picker turns
    // off cmdk's own filtering, so anything left on screen during the debounce
    // is a result for the previous query — and still selectable.
    setLoading(true);
    setError(null);

    const timerId = window.setTimeout(async () => {
      try {
        const result = await searchGithubRepositories({ tokenId, query: query.trim(), limit: 20 });
        if (!isDisposed) {
          setRepos(result);
        }
      } catch (searchError) {
        if (!isDisposed) {
          setError(searchError instanceof Error ? searchError.message : 'Failed to search repositories');
        }
      } finally {
        if (!isDisposed) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      isDisposed = true;
      window.clearTimeout(timerId);
    };
  }, [enabled, query, tokenId]);

  return { repos, loading, error };
};
