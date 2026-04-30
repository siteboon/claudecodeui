import { authenticatedFetch } from '../../../utils/api';

import { useApiSource } from './useApiSource';

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
  return useApiSource<CommitResult, CommitsResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => {
      const params = new URLSearchParams({ project: projectId!, limit: '50' });
      return authenticatedFetch(`/api/git/commits?${params.toString()}`, { signal });
    },
    parse: (data) => {
      if (!data.commits) return [];
      return data.commits.map<CommitResult>((c) => ({
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message,
        author: c.author,
      }));
    },
  });
}
