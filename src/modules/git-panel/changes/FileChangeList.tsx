import { FILE_STATUS_GROUPS } from '@/shared/constants';
import type { FileStatusCode, GitDiffMap, GitStatusResponse } from '@/shared/types';
import FileChangeItem from '@/modules/git-panel/changes/FileChangeItem';

type FileChangeListProps = {
  gitStatus: GitStatusResponse;
  gitDiff: GitDiffMap;
  expandedFiles: Set<string>;
  selectedFiles: Set<string>;
  isMobile: boolean;
  wrapText: boolean;
  filePaths?: Set<string>;
  onToggleSelected: (filePath: string) => void;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
  onRequestFileAction: (filePath: string, status: FileStatusCode) => void;
};

/** Rendered by ChangesView to walk the modified/added/deleted/untracked groups and render a row per file. */
export default function FileChangeList({
  gitStatus,
  gitDiff,
  expandedFiles,
  selectedFiles,
  isMobile,
  wrapText,
  filePaths,
  onToggleSelected,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
  onRequestFileAction,
}: FileChangeListProps) {
  return (
    <>
      {FILE_STATUS_GROUPS.map(({ key, status }) =>
        (gitStatus[key] || [])
          .filter((filePath) => !filePaths || filePaths.has(filePath))
          .map((filePath) => (
            <FileChangeItem
              key={filePath}
              filePath={filePath}
              status={status}
              isMobile={isMobile}
              isExpanded={expandedFiles.has(filePath)}
              isSelected={selectedFiles.has(filePath)}
              diff={gitDiff[filePath]}
              wrapText={wrapText}
              onToggleSelected={onToggleSelected}
              onToggleExpanded={onToggleExpanded}
              onOpenFile={onOpenFile}
              onToggleWrapText={onToggleWrapText}
              onRequestFileAction={onRequestFileAction}
            />
          )),
      )}
    </>
  );
}
