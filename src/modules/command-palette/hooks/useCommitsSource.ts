import { api } from '@/shared/api';
import { useApiSource } from '@/modules/command-palette/hooks/useApiSource';

export type CommitResult = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
};

const COMMIT_RESULT_LIMIT = 50;

type CommitsResponse = {
  commits?: Array<{ hash: string; message: string; author: string }>;
  error?: string;
};

export function useCommitsSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<CommitResult, CommitsResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => api.git.commits(projectId!, { limit: COMMIT_RESULT_LIMIT }, { signal }),
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
