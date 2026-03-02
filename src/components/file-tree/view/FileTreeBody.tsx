import type { ReactNode, RefObject } from 'react';
import { Folder, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileTreeNode, FileTreeViewMode } from '../types/types';
import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeList from './FileTreeList';

type FileTreeBodyProps = {
  files: FileTreeNode[];
  filteredFiles: FileTreeNode[];
  searchQuery: string;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNode) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNode) => void;
  onDelete?: (item: FileTreeNode) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  onRefresh?: () => void;
  // Rename state for inline editing
  renamingItem?: FileTreeNode | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
};

export default function FileTreeBody({
  files,
  filteredFiles,
  searchQuery,
  viewMode,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
  onRefresh,
  renamingItem,
  renameValue,
  setRenameValue,
  handleConfirmRename,
  handleCancelRename,
  renameInputRef,
  operationLoading,
}: FileTreeBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      {files.length === 0 ? (
        <FileTreeEmptyState
          icon={Folder}
          title={t('fileTree.noFilesFound')}
          description={t('fileTree.checkProjectPath')}
        />
      ) : filteredFiles.length === 0 && searchQuery ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.noMatchesFound')}
          description={t('fileTree.tryDifferentSearch')}
        />
      ) : (
        <FileTreeList
          items={filteredFiles}
          viewMode={viewMode}
          expandedDirs={expandedDirs}
          onItemClick={onItemClick}
          renderFileIcon={renderFileIcon}
          formatFileSize={formatFileSize}
          formatRelativeTime={formatRelativeTime}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onDownload={onDownload}
          onRefresh={onRefresh}
          renamingItem={renamingItem}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          handleConfirmRename={handleConfirmRename}
          handleCancelRename={handleCancelRename}
          renameInputRef={renameInputRef}
          operationLoading={operationLoading}
        />
      )}
    </>
  );
}
