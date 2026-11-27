import { useEffect, useRef } from 'react';

import { findFileTreeNode } from '@/modules/file-tree/utils/fileTreeUtils';
import type { FileTreeNode } from '@/shared/types';

type UseExpandedDirectoryLoadingArgs = {
  files: FileTreeNode[];
  expandedDirs: Set<string>;
  loadDirectory: (directoryPath: string) => Promise<void>;
  onLoadFailed: (directoryPath: string, message: string) => void;
};

/**
 * Fetches any open directory whose contents the server has not sent yet.
 *
 * Driving this off `expandedDirs` rather than the click handler means a tree
 * refresh (which comes back shallow for large projects) re-fills every
 * directory the user still has open, parents before children.
 */
export function useExpandedDirectoryLoading({
  files,
  expandedDirs,
  loadDirectory,
  onLoadFailed,
}: UseExpandedDirectoryLoadingArgs): void {
  // Directories with a request in flight; a ref because it must not trigger renders.
  const inFlightRef = useRef(new Set<string>());

  useEffect(() => {
    for (const directoryPath of expandedDirs) {
      if (inFlightRef.current.has(directoryPath)) {
        continue;
      }
      const node = findFileTreeNode(files, directoryPath);
      if (!node || node.childrenLoaded !== false) {
        continue;
      }

      inFlightRef.current.add(directoryPath);
      loadDirectory(directoryPath)
        .catch((error: unknown) => {
          // The caller collapses the directory, otherwise this effect would retry forever.
          onLoadFailed(directoryPath, error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          inFlightRef.current.delete(directoryPath);
        });
    }
  }, [expandedDirs, files, loadDirectory, onLoadFailed]);
}
