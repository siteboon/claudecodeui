import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import ImageViewer from './ImageViewer';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { useExpandedDirectories } from '../hooks/useExpandedDirectories';
import { useFileTreeData } from '../hooks/useFileTreeData';
import { useFileOperations } from '../hooks/useFileOperations';
import { useFileTreeSearch } from '../hooks/useFileTreeSearch';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import type { FileTreeImageSelection, FileTreeNode } from '../types/types';
import { formatFileSize, formatRelativeTime, isImageFile } from '../utils/fileTreeUtils';
import FileTreeBody from './FileTreeBody';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import { Project } from '../../../types/app';
import { AlertTriangle, Check, XCircle, FileText, FolderPlus, RefreshCw, Pencil, Trash2, Copy } from 'lucide-react';

type ToastType = {
  message: string;
  type: 'success' | 'error';
};

type FileTreeProps = {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
};

export default function FileTree({ selectedProject, onFileOpen }: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  const [toast, setToast] = useState<ToastType | null>(null);
  const [contextMenuItem, setContextMenuItem] = useState<FileTreeNode | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);

  const { files, loading, refresh } = useFileTreeData(selectedProject);
  const { viewMode, changeViewMode } = useFileTreeViewMode();
  const { expandedDirs, toggleDirectory, expandDirectories } = useExpandedDirectories();
  const { searchQuery, setSearchQuery, filteredFiles } = useFileTreeSearch({
    files,
    expandDirectories,
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const fileOperations = useFileOperations({
    projectName: selectedProject?.name,
    onRefresh: refresh,
    showToast,
  });

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Focus rename input when shown
  useEffect(() => {
    if (fileOperations.renamingItem && fileOperations.renameInputRef.current) {
      fileOperations.renameInputRef.current.focus();
      const extIndex = fileOperations.renameValue.lastIndexOf('.');
      if (extIndex > 0) {
        fileOperations.renameInputRef.current.setSelectionRange(0, extIndex);
      } else {
        fileOperations.renameInputRef.current.select();
      }
    }
  }, [fileOperations.renamingItem, fileOperations.renameValue]);

  // Focus new item input when shown
  useEffect(() => {
    if (fileOperations.isCreating && fileOperations.newItemInputRef.current) {
      fileOperations.newItemInputRef.current.focus();
      fileOperations.newItemInputRef.current.select();
    }
  }, [fileOperations.isCreating]);

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  // Centralized click behavior keeps file actions identical across all presentation modes.
  const handleItemClick = useCallback(
    (item: FileTreeNode) => {
      if (fileOperations.isCreating || fileOperations.renamingItem) return;

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
    [onFileOpen, selectedProject, toggleDirectory, fileOperations.isCreating, fileOperations.renamingItem],
  );

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileTreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;
    const menuWidth = 200;
    const menuHeight = 300;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      adjustedY = window.innerHeight - menuHeight - 10;
    }

    setContextMenuPosition({ x: adjustedX, y: adjustedY });
    setContextMenuItem(item);
    setIsContextMenuOpen(true);
  }, []);

  const closeContextMenu = useCallback(() => {
    setIsContextMenuOpen(false);
    setContextMenuItem(null);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (isContextMenuOpen) {
        closeContextMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    };

    if (isContextMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isContextMenuOpen, closeContextMenu]);

  // Context menu actions
  const handleContextMenuAction = useCallback((action: string) => {
    closeContextMenu();
    switch (action) {
      case 'newFile':
        fileOperations.handleStartCreate(contextMenuItem?.path || '', 'file');
        break;
      case 'newFolder':
        fileOperations.handleStartCreate(contextMenuItem?.path || '', 'directory');
        break;
      case 'rename':
        if (contextMenuItem) {
          fileOperations.handleStartRename(contextMenuItem);
        }
        break;
      case 'delete':
        if (contextMenuItem) {
          fileOperations.handleStartDelete(contextMenuItem);
        }
        break;
      case 'copyPath':
        if (contextMenuItem) {
          fileOperations.handleCopyPath(contextMenuItem);
        }
        break;
      case 'refresh':
        refresh();
        break;
    }
  }, [closeContextMenu, contextMenuItem, fileOperations, refresh]);

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
        onNewFile={() => fileOperations.handleStartCreate('', 'file')}
        onNewFolder={() => fileOperations.handleStartCreate('', 'directory')}
        onRefresh={refresh}
      />

      {viewMode === 'detailed' && filteredFiles.length > 0 && <FileTreeDetailedColumns />}

      <div
        ref={treeRef}
        className="flex-1 overflow-auto"
        onDragOver={(e) => fileOperations.handleDragOver(e)}
        onDragLeave={fileOperations.handleDragLeave}
        onDrop={(e) => fileOperations.handleDrop(e)}
        onContextMenu={(e) => handleContextMenu(e, null)}
      >
        <div
          className={cn(
            'min-h-full transition-colors p-2',
            fileOperations.isDragOver && !fileOperations.dropTarget && 'bg-primary/5'
          )}
        >
          {/* New item input row */}
          {fileOperations.isCreating && (
            <div className="flex items-center gap-2 py-1 px-1 mb-1">
              {fileOperations.newItemType === 'directory' ? (
                <span className="text-muted-foreground">📁</span>
              ) : (
                <span className="text-muted-foreground">📄</span>
              )}
              <input
                ref={fileOperations.newItemInputRef}
                type="text"
                value={fileOperations.newItemName}
                onChange={(e) => fileOperations.setNewItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    fileOperations.handleConfirmCreate();
                  } else if (e.key === 'Escape') {
                    fileOperations.handleCancelCreate();
                  }
                }}
                onBlur={() => {
                  if (fileOperations.newItemName.trim()) {
                    fileOperations.handleConfirmCreate();
                  } else {
                    fileOperations.handleCancelCreate();
                  }
                }}
                className="flex-1 min-w-0 text-sm bg-background border border-primary rounded px-2 py-1 focus:outline-none"
                placeholder={fileOperations.newItemType === 'file' ? t('fileTree.newFilePlaceholder', 'filename.ext') : t('fileTree.newFolderPlaceholder', 'folder name')}
              />
            </div>
          )}

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
          />
        </div>
      </div>

      {/* Context menu */}
      {isContextMenuOpen && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            zIndex: 9999,
          }}
          className={cn(
            'min-w-[180px] py-1 px-1',
            'bg-popover border border-border rounded-lg shadow-lg',
            'animate-in fade-in-0 zoom-in-95'
          )}
        >
          {fileOperations.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {contextMenuItem?.type === 'file' ? (
                <>
                  <ContextMenuItem icon={Pencil} label={t('fileTree.context.rename', 'Rename')} onClick={() => handleContextMenuAction('rename')} />
                  <ContextMenuItem icon={Trash2} label={t('fileTree.context.delete', 'Delete')} onClick={() => handleContextMenuAction('delete')} danger />
                  <ContextMenuDivider />
                  <ContextMenuItem icon={Copy} label={t('fileTree.context.copyPath', 'Copy Path')} onClick={() => handleContextMenuAction('copyPath')} />
                </>
              ) : contextMenuItem?.type === 'directory' ? (
                <>
                  <ContextMenuItem icon={FileText} label={t('fileTree.context.newFile', 'New File')} onClick={() => handleContextMenuAction('newFile')} />
                  <ContextMenuItem icon={FolderPlus} label={t('fileTree.context.newFolder', 'New Folder')} onClick={() => handleContextMenuAction('newFolder')} />
                  <ContextMenuDivider />
                  <ContextMenuItem icon={Pencil} label={t('fileTree.context.rename', 'Rename')} onClick={() => handleContextMenuAction('rename')} />
                  <ContextMenuItem icon={Trash2} label={t('fileTree.context.delete', 'Delete')} onClick={() => handleContextMenuAction('delete')} danger />
                  <ContextMenuDivider />
                  <ContextMenuItem icon={Copy} label={t('fileTree.context.copyPath', 'Copy Path')} onClick={() => handleContextMenuAction('copyPath')} />
                </>
              ) : (
                <>
                  <ContextMenuItem icon={FileText} label={t('fileTree.context.newFile', 'New File')} onClick={() => handleContextMenuAction('newFile')} />
                  <ContextMenuItem icon={FolderPlus} label={t('fileTree.context.newFolder', 'New Folder')} onClick={() => handleContextMenuAction('newFolder')} />
                  <ContextMenuDivider />
                  <ContextMenuItem icon={RefreshCw} label={t('fileTree.context.refresh', 'Refresh')} onClick={() => handleContextMenuAction('refresh')} />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {fileOperations.deleteDialog.isOpen && fileOperations.deleteDialog.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-4 max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h3 className="font-semibold">{t('fileTree.delete.title', 'Confirm Delete')}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('fileTree.delete.message', `Are you sure you want to delete "${fileOperations.deleteDialog.item.name}"?`)}
              {fileOperations.deleteDialog.item.type === 'directory' && (
                <span className="block mt-1 text-red-500">
                  {t('fileTree.delete.folderWarning', 'This folder and all its contents will be deleted.')}
                </span>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={fileOperations.handleCancelDelete}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={fileOperations.handleConfirmDelete}
                disabled={fileOperations.isLoading}
                className="px-3 py-1.5 text-sm rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {fileOperations.isLoading ? t('common.deleting', 'Deleting...') : t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in-0 zoom-in-95">
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border',
              toast.type === 'success'
                ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800'
                : 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
            )}
          >
            {toast.type === 'success' ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            <span
              className={cn(
                'text-sm',
                toast.type === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
              )}
            >
              {toast.message}
            </span>
          </div>
        </div>
      )}

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  );
}

// Context menu item component
type ContextMenuItemProps = {
  icon?: typeof FileText;
  label: string;
  onClick: () => void;
  danger?: boolean;
};

function ContextMenuItem({ icon: Icon, label, onClick, danger = false }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-md transition-colors',
        'hover:bg-accent focus:outline-none focus:bg-accent',
        danger && 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
      )}
    >
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
      {label}
    </button>
  );
}

function ContextMenuDivider() {
  return <div className="h-px bg-border my-1 mx-2" />;
}
