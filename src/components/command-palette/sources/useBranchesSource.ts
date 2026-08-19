import { api } from '../../../shared/api';

import { useApiSource } from './useApiSource';

export type BranchResult = { name: string };

interface BranchesResponse {
  localBranches?: string[];
}

export function useBranchesSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<BranchResult, BranchesResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => api.git.branches(projectId!, { signal }),
    parse: (data) => (data.localBranches ?? []).map((name) => ({ name })),
  });
}
