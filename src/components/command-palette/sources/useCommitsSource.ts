import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export type CommitResult = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
};

interface CommitsResponse {
  commits?: Array<{ hash: string; message: string; author: string }>;
  error?: string;
}

export function useCommitsSource(projectId: string | undefined, enabled: boolean) {
  const [items, setItems] = useState<CommitResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const params = new URLSearchParams({ project: projectId, limit: '50' });
    authenticatedFetch(`/api/git/commits?${params.toString()}`)
      .then((r) => r.json() as Promise<CommitsResponse>)
      .then((data) => {
        if (cancelled) return;
        if (!data.commits) {
          setItems([]);
          return;
        }
        setItems(
          data.commits.map<CommitResult>((c) => ({
            hash: c.hash,
            shortHash: c.hash.slice(0, 7),
            message: c.message,
            author: c.author,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return { items, isLoading };
}
