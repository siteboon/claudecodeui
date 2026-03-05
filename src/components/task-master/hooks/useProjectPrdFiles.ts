import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { PrdFile } from '../types';

type UseProjectPrdFilesOptions = {
  projectName?: string;
};

type PrdResponse = {
  prdFiles?: PrdFile[];
  prds?: PrdFile[];
};

function normalizePrdResponse(responseData: PrdResponse): PrdFile[] {
  if (Array.isArray(responseData.prdFiles)) {
    return responseData.prdFiles;
  }

  if (Array.isArray(responseData.prds)) {
    return responseData.prds;
  }

  return [];
}

export function useProjectPrdFiles({ projectName }: UseProjectPrdFilesOptions) {
  const [prdFiles, setPrdFiles] = useState<PrdFile[]>([]);
  const [isLoadingPrdFiles, setIsLoadingPrdFiles] = useState(false);

  const refreshPrdFiles = useCallback(async () => {
    if (!projectName) {
      setPrdFiles([]);
      return;
    }

    try {
      setIsLoadingPrdFiles(true);
      const response = await api.get(`/taskmaster/prd/${encodeURIComponent(projectName)}`);

      if (!response.ok) {
        setPrdFiles([]);
        return;
      }

      const data = (await response.json()) as PrdResponse;
      setPrdFiles(normalizePrdResponse(data));
    } catch (error) {
      console.error('Failed to load PRD files:', error);
      setPrdFiles([]);
    } finally {
      setIsLoadingPrdFiles(false);
    }
  }, [projectName]);

  useEffect(() => {
    void refreshPrdFiles();
  }, [refreshPrdFiles]);

  return {
    prdFiles,
    isLoadingPrdFiles,
    refreshPrdFiles,
  };
}
