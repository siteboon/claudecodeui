import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import ImageViewer from './ImageViewer';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { useExpandedDirectories } from '../hooks/useExpandedDirectories';
import { useFileTreeData } from '../hooks/useFileTreeData';
import { useFileTreeSearch } from '../hooks/useFileTreeSearch';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import type { FileTreeImageSelection, FileTreeNode } from '../types/types';
import { formatFileSize, formatRelativeTime, isImageFile } from '../utils/fileTreeUtils';
import FileTreeBody from './FileTreeBody';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import { Project } from '../../../types/app';

type FileTreeProps =  {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
  // File operation callbacks (optional - enables context menu)
  onRename?: (item: FileTreeNode) => void;
  onDelete?: (item: FileTreeNode) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
}

export default function FileTree({
  selectedProject,
  onFileOpen,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);

  const { files, loading, refreshFiles } = useFileTreeData(selectedProject);
  const { viewMode, changeViewMode } = useFileTreeViewMode();
  const { expandedDirs, toggleDirectory, expandDirectories } = useExpandedDirectories();
  const { searchQuery, setSearchQuery, filteredFiles } = useFileTreeSearch({
    files,
    expandDirectories,
  });

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  // Centralized click behavior keeps file actions identical across all presentation modes.
  const handleItemClick = useCallback(
    (item: FileTreeNode) => {
      if (item.type === 'directory') {
        toggleDirectory(item.path);
        return;
      }

      if (isImageFile(item.name) && selectedProject) {
        setSelectedImage({
          name: item.name,
          path: item.path,
          projectPath: selectedProject.path,
          projectName: selectedProject.name,
        });
        return;
      }

      onFileOpen?.(item.path);
    },
    [onFileOpen, selectedProject, toggleDirectory],
  );

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  // Context menu handlers - wrap callbacks with refresh
  const handleRename = useCallback((item: FileTreeNode) => {
    onRename?.(item);
    refreshFiles();
  }, [onRename, refreshFiles]);

  const handleDelete = useCallback((item: FileTreeNode) => {
    onDelete?.(item);
    refreshFiles();
  }, [onDelete, refreshFiles]);

  const handleNewFile = useCallback((path: string) => {
    onNewFile?.(path);
    refreshFiles();
  }, [onNewFile, refreshFiles]);

  const handleNewFolder = useCallback((path: string) => {
    onNewFolder?.(path);
    refreshFiles();
  }, [onNewFolder, refreshFiles]);

  const handleCopyPath = useCallback((item: FileTreeNode) => {
    onCopyPath?.(item);
  }, [onCopyPath]);

  const handleDownload = useCallback((item: FileTreeNode) => {
    onDownload?.(item);
  }, [onDownload]);

  const handleRefresh = useCallback(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Check if any context menu callbacks are provided
  const hasContextMenu = onRename || onDelete || onNewFile || onNewFolder || onCopyPath || onDownload;

  if (loading) {
    return <FileTreeLoadingState />;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <FileTreeHeader
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      {viewMode === 'detailed' && filteredFiles.length > 0 && <FileTreeDetailedColumns />}

      <FileTreeBody
        files={files}
        filteredFiles={filteredFiles}
        searchQuery={searchQuery}
        viewMode={viewMode}
        expandedDirs={expandedDirs}
        onItemClick={handleItemClick}
        renderFileIcon={renderFileIcon}
        formatFileSize={formatFileSize}
        formatRelativeTime={formatRelativeTimeLabel}
        onRename={hasContextMenu ? handleRename : undefined}
        onDelete={hasContextMenu ? handleDelete : undefined}
        onNewFile={hasContextMenu ? handleNewFile : undefined}
        onNewFolder={hasContextMenu ? handleNewFolder : undefined}
        onCopyPath={hasContextMenu ? handleCopyPath : undefined}
        onDownload={hasContextMenu ? handleDownload : undefined}
        onRefresh={hasContextMenu ? handleRefresh : undefined}
      />

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}
