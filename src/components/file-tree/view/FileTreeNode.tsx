import type { ReactNode, RefObject } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '../../../lib/utils';
import FileContextMenu from '../../FileContextMenu';
import { Input } from '../../ui/input';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';

type FileTreeNodeProps = {
  item: FileTreeNodeType;
  level: number;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  // Rename state for inline editing
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
};

type TreeItemIconProps = {
  item: FileTreeNodeType;
  isOpen: boolean;
  renderFileIcon: (filename: string) => ReactNode;
};

function TreeItemIcon({ item, isOpen, renderFileIcon }: TreeItemIconProps) {
  if (item.type === 'directory') {
    return (
      <span className="flex items-center gap-0.5 flex-shrink-0">
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
        {isOpen ? (
          <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </span>
    );
  }

  return <span className="flex items-center flex-shrink-0 ml-[18px]">{renderFileIcon(item.name)}</span>;
}

export default function FileTreeNode({
  item,
  level,
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
}: FileTreeNodeProps) {
  const isDirectory = item.type === 'directory';
  const isOpen = isDirectory && expandedDirs.has(item.path);
  const hasChildren = Boolean(isDirectory && item.children && item.children.length > 0);
  const isRenaming = renamingItem?.path === item.path;

  const nameClassName = cn(
    'text-[13px] leading-tight truncate',
    isDirectory ? 'font-medium text-foreground' : 'text-foreground/90',
  );

  // View mode only changes the row layout; selection, expansion, and recursion stay shared.
  const rowClassName = cn(
    viewMode === 'detailed'
      ? 'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100'
      : viewMode === 'compact'
      ? 'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100'
      : 'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm hover:bg-accent/60 transition-colors duration-100',
    isDirectory && isOpen && 'border-l-2 border-primary/30',
    (isDirectory && !isOpen) || !isDirectory ? 'border-l-2 border-transparent' : '',
  );

  // Render rename input if this item is being renamed
  if (isRenaming && setRenameValue && handleConfirmRename && handleCancelRename) {
    return (
      <div
        className={cn(rowClassName, 'bg-accent/30')}
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
        <Input
          ref={renameInputRef}
          type="text"
          value={renameValue || ''}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') handleConfirmRename();
            if (e.key === 'Escape') handleCancelRename();
          }}
          onBlur={() => {
            setTimeout(() => {
              handleConfirmRename();
            }, 100);
          }}
          className="h-6 text-sm flex-1"
          disabled={operationLoading}
        />
      </div>
    );
  }

  const rowContent = (
    <div
      className={rowClassName}
      style={{ paddingLeft: `${level * 16 + 4}px` }}
      onClick={() => onItemClick(item)}
    >
      {viewMode === 'detailed' ? (
        <>
          <div className="col-span-5 flex items-center gap-1.5 min-w-0">
            <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
            <span className={nameClassName}>{item.name}</span>
          </div>
          <div className="col-span-2 text-sm text-muted-foreground tabular-nums">
            {item.type === 'file' ? formatFileSize(item.size) : ''}
          </div>
          <div className="col-span-3 text-sm text-muted-foreground">{formatRelativeTime(item.modified)}</div>
          <div className="col-span-2 text-sm text-muted-foreground font-mono">{item.permissionsRwx || ''}</div>
        </>
      ) : viewMode === 'compact' ? (
        <>
          <div className="flex items-center gap-1.5 min-w-0">
            <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
            <span className={nameClassName}>{item.name}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-shrink-0 ml-2">
            {item.type === 'file' && (
              <>
                <span className="tabular-nums">{formatFileSize(item.size)}</span>
                <span className="font-mono">{item.permissionsRwx}</span>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <TreeItemIcon item={item} isOpen={isOpen} renderFileIcon={renderFileIcon} />
          <span className={nameClassName}>{item.name}</span>
        </>
      )}
    </div>
  );

  // Check if context menu callbacks are provided
  const hasContextMenu = onRename || onDelete || onNewFile || onNewFolder || onCopyPath || onDownload || onRefresh;

  return (
    <div className="select-none">
      {hasContextMenu ? (
        <FileContextMenu
          item={item}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onDownload={onDownload}
          onRefresh={onRefresh}
        >
          {rowContent}
        </FileContextMenu>
      ) : (
        rowContent
      )}

      {isDirectory && isOpen && hasChildren && (
        <div className="relative">
          <span
            className="absolute top-0 bottom-0 border-l border-border/40"
            style={{ left: `${level * 16 + 14}px` }}
            aria-hidden="true"
          />
          {item.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              level={level + 1}
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
          ))}
        </div>
      )}
    </div>
  );
}
