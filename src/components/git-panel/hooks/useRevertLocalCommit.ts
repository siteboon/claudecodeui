import { useCallback, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { GitOperationResponse } from '../types/types';

type UseRevertLocalCommitOptions = {
  // DB primary key for the project; forwarded to the git API via the
  // `project` body param.
  projectId: string | null;
  onSuccess?: () => void;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function useRevertLocalCommit({ projectId, onSuccess }: UseRevertLocalCommitOptions) {
  const [isRevertingLocalCommit, setIsRevertingLocalCommit] = useState(false);

  const revertLatestLocalCommit = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setIsRevertingLocalCommit(true);
    try {
      const response = await authenticatedFetch('/api/git/revert-local-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectId }),
      });
      const data = await readJson<GitOperationResponse>(response);

      if (!data.success) {
        console.error('Revert local commit failed:', data.error || data.details || 'Unknown error');
        return;
      }

      onSuccess?.();
    } catch (error) {
      console.error('Error reverting local commit:', error);
    } finally {
      setIsRevertingLocalCommit(false);
    }
  }, [onSuccess, projectId]);

  return {
    isRevertingLocalCommit,
    revertLatestLocalCommit,
  };
}
