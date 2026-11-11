import { useCallback, useState } from 'react';

import { api } from '@/shared/api';
import type { GitOperationResponse, GitTarget } from '@/shared/types';

type UseRevertLocalCommitOptions = {
  // Project (DB primary key) and, when nested, the repository the panel shows.
  target: GitTarget | null;
  onSuccess?: () => void;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function useRevertLocalCommit({ target, onSuccess }: UseRevertLocalCommitOptions) {
  const [isRevertingLocalCommit, setIsRevertingLocalCommit] = useState(false);

  const revertLatestLocalCommit = useCallback(async () => {
    if (!target) {
      return;
    }

    setIsRevertingLocalCommit(true);
    try {
      const response = await api.git.revertLocalCommit(target);
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
  }, [onSuccess, target]);

  return {
    isRevertingLocalCommit,
    revertLatestLocalCommit,
  };
}
