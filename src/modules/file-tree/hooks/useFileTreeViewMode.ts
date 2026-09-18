import { useCallback, useState } from 'react';

import type { FileTreeViewMode } from '@/shared/types';

const FILE_TREE_VIEW_MODE_STORAGE_KEY = 'file-tree-view-mode';

const FILE_TREE_DEFAULT_VIEW_MODE: FileTreeViewMode = 'detailed';

const FILE_TREE_VIEW_MODES: FileTreeViewMode[] = ['simple', 'compact', 'detailed'];

type UseFileTreeViewModeResult = {
  viewMode: FileTreeViewMode;
  changeViewMode: (mode: FileTreeViewMode) => void;
};

function readStoredViewMode(): FileTreeViewMode {
  try {
    const savedViewMode = localStorage.getItem(FILE_TREE_VIEW_MODE_STORAGE_KEY);
    if (savedViewMode && FILE_TREE_VIEW_MODES.includes(savedViewMode as FileTreeViewMode)) {
      return savedViewMode as FileTreeViewMode;
    }
  } catch {
    // Keep default view mode when storage is unavailable.
  }
  return FILE_TREE_DEFAULT_VIEW_MODE;
}

export function useFileTreeViewMode(): UseFileTreeViewModeResult {
  // Read once during initialization instead of syncing from an effect, so the
  // first paint already uses the persisted mode.
  const [viewMode, setViewMode] = useState<FileTreeViewMode>(readStoredViewMode);

  const changeViewMode = useCallback((mode: FileTreeViewMode) => {
    setViewMode(mode);

    try {
      localStorage.setItem(FILE_TREE_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Keep runtime state even when persistence fails.
    }
  }, []);

  return {
    viewMode,
    changeViewMode,
  };
}

