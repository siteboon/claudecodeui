import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export type BranchResult = {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
};

interface BranchesResponse {
  branches?: Array<{ name: string; current?: boolean; isRemote?: boolean }>;
}

export function useBranchesSource(projectId: string | undefined, enabled: boolean) {
  const [items, setItems] = useState<BranchResult[]>([]);

  useEffect(() => {
    if (!enabled || !projectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ project: projectId });
    authenticatedFetch(`/api/git/branches?${params.toString()}`)
      .then((r) => r.json() as Promise<BranchesResponse>)
      .then((data) => {
        if (cancelled) return;
        const list = data.branches ?? [];
        setItems(
          list.map<BranchResult>((b) => ({
            name: b.name,
            isCurrent: Boolean(b.current),
            isRemote: Boolean(b.isRemote),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return { items };
}
