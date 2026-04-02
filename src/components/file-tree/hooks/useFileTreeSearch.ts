import { useEffect, useState } from 'react';
import { collectExpandedDirectoryPaths, filterFileTree } from '../utils/fileTreeUtils';
import type { FileTreeNode } from '../types/types';

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
  const [filteredFiles, setFilteredFiles] = useState<FileTreeNode[]>(files);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      setFilteredFiles(files);
      return;
    }

    const filtered = filterFileTree(files, query);
    setFilteredFiles(filtered);
    // Keep search results visible by opening every matching ancestor directory once per query update.
    expandDirectories(collectExpandedDirectoryPaths(filtered));
  }, [files, searchQuery, expandDirectories]);

  return {
    searchQuery,
    setSearchQuery,
    filteredFiles,
  };
}
