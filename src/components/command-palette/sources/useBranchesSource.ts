import { authenticatedFetch } from '../../../utils/api';

import { useApiSource } from './useApiSource';

export type BranchResult = {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
};

interface BranchesResponse {
  branches?: Array<{ name: string; current?: boolean; isRemote?: boolean }>;
}

export function useBranchesSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<BranchResult, BranchesResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => {
      const params = new URLSearchParams({ project: projectId! });
      return authenticatedFetch(`/api/git/branches?${params.toString()}`, { signal });
    },
    parse: (data) => {
      const list = data.branches ?? [];
      return list.map<BranchResult>((b) => ({
        name: b.name,
        isCurrent: Boolean(b.current),
        isRemote: Boolean(b.isRemote),
      }));
    },
  });
}
