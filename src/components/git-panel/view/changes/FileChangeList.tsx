import { FILE_STATUS_GROUPS } from '../../constants/constants';
import type { FileStatusCode, GitDiffMap, GitStatusResponse } from '../../types/types';
import FileChangeItem from './FileChangeItem';

type FileChangeListProps = {
  gitStatus: GitStatusResponse;
  gitDiff: GitDiffMap;
  expandedFiles: Set<string>;
  selectedFiles: Set<string>;
  isMobile: boolean;
  wrapText: boolean;
  onToggleSelected: (filePath: string) => void;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
  onRequestFileAction: (filePath: string, status: FileStatusCode) => void;
};

export default function FileChangeList({
  gitStatus,
  gitDiff,
  expandedFiles,
  selectedFiles,
  isMobile,
  wrapText,
  onToggleSelected,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
  onRequestFileAction,
}: FileChangeListProps) {
  return (
    <>
      {FILE_STATUS_GROUPS.map(({ key, status }) =>
        (gitStatus[key] || []).map((filePath) => (
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
