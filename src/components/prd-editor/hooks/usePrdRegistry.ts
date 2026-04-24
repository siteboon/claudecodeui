import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { ExistingPrdFile, PrdListResponse } from '../types';

type UsePrdRegistryArgs = {
  // DB primary key of the project (post migration).
  projectId?: string;
};

type UsePrdRegistryResult = {
  existingPrds: ExistingPrdFile[];
  refreshExistingPrds: () => Promise<void>;
};

function getPrdFiles(data: PrdListResponse): ExistingPrdFile[] {
  return data.prdFiles || data.prds || [];
}

export function usePrdRegistry({ projectId }: UsePrdRegistryArgs): UsePrdRegistryResult {
  const [existingPrds, setExistingPrds] = useState<ExistingPrdFile[]>([]);

  const refreshExistingPrds = useCallback(async () => {
    if (!projectId) {
      setExistingPrds([]);
      return;
    }

    try {
      const response = await api.get(`/taskmaster/prd/${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        setExistingPrds([]);
        return;
      }

      const data = (await response.json()) as PrdListResponse;
      setExistingPrds(getPrdFiles(data));
    } catch (error) {
      console.error('Failed to fetch existing PRDs:', error);
      setExistingPrds([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshExistingPrds();
  }, [refreshExistingPrds]);

  return {
    existingPrds,
    refreshExistingPrds,
  };
}
