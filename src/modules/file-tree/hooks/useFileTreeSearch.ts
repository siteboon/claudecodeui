import { useEffect, useMemo, useState } from 'react';

import { collectExpandedDirectoryPaths, filterFileTree } from '@/modules/file-tree/utils/fileTreeUtils';
import type { FileTreeNode } from '@/shared/types';

type UseFileTreeSearchArgs = {
  files: FileTreeNode[];
  expandDirectories: (paths: string[]) => void;
};

type UseFileTreeSearchResult = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredFiles: FileTreeNode[];
};

export function useFileTreeSearch({
  files,
  expandDirectories,
}: UseFileTreeSearchArgs): UseFileTreeSearchResult {
  const [searchQuery, setSearchQuery] = useState('');

  // Derived, not stored: mirroring the filter into state made every keystroke
  // (and every tree refresh) cost an extra render, and left `filteredFiles` one
  // render behind `files`.
  const filteredFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query ? filterFileTree(files, query) : files;
  }, [files, searchQuery]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }
    // Keep search results visible by opening every matching ancestor directory once per query update.
    expandDirectories(collectExpandedDirectoryPaths(filteredFiles));
  }, [expandDirectories, filteredFiles, searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    filteredFiles,
  };
}
