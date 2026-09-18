import { useCallback } from 'react';

import { api } from '@/shared/api';

const readGitResponse = async (request: Promise<Response>) => (await request).json();

export function useGitActions(projectId: string | undefined) {
  const fetch = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return readGitResponse(api.git.fetch(projectId));
  }, [projectId]);

  const pull = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return readGitResponse(api.git.pull(projectId));
  }, [projectId]);

  const push = useCallback(() => {
    if (!projectId) return Promise.resolve();
    return readGitResponse(api.git.push(projectId));
  }, [projectId]);

  const checkout = useCallback(
    (branch: string) => {
      if (!projectId) return Promise.resolve();
      return readGitResponse(api.git.checkout(projectId, branch));
    },
    [projectId],
  );

  return { fetch, pull, push, checkout };
}
