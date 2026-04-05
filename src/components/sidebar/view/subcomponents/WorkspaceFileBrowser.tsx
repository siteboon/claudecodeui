import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File,
  FolderClosed,
  FolderOpen,
  GripVertical,
  Upload,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useFileTreeData } from '../../../file-tree/hooks/useFileTreeData';
import { useFileTreeUpload } from '../../../file-tree/hooks/useFileTreeUpload';
import type { FileTreeNode } from '../../../file-tree/types/types';
import type { Project } from '../../../../types/app';
import { ScrollArea } from '../../../../shared/view/ui';
import { ICON_SIZE_CLASS, getFileIconData } from '../../../file-tree/constants/fileIcons';

interface WorkspaceFileBrowserProps {
  selectedProject: Project | null;
}

function FileNodeItem({
  node,
  depth,
  expanded_dirs,
  onToggle,
  onFileClick,
}: {
  node: FileTreeNode;
  depth: number;
  expanded_dirs: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
}) {
  const is_dir = node.type === 'directory';
  const is_expanded = expanded_dirs.has(node.path);

  const HandleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (is_dir) return;
      e.dataTransfer.setData('text/plain', node.path);
      e.dataTransfer.setData('application/x-file-reference', node.path);
      e.dataTransfer.effectAllowed = 'copy';
    },
    [node.path, is_dir],
  );

  const icon_data = !is_dir ? getFileIconData(node.name) : null;
  const FileIcon = icon_data?.icon || File;
  const icon_color = icon_data?.color || 'text-muted-foreground';

  return (
    <>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-1 rounded-md px-1 py-[3px] text-[12px] leading-tight',
          'hover:bg-accent/50 active:bg-accent/70',
          !is_dir && 'cursor-grab active:cursor-grabbing',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        draggable={!is_dir}
        onDragStart={HandleDragStart}
        onClick={() => {
          if (is_dir) {
            onToggle(node.path);
          } else {
            onFileClick(node.path);
          }
        }}
      >
        {is_dir ? (
          <>
            {is_expanded ? (
              <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            )}
            {is_expanded ? (
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            ) : (
              <FolderClosed className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            )}
          </>
        ) : (
          <>
            <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/50" />
            <FileIcon className={cn(ICON_SIZE_CLASS, 'flex-shrink-0', icon_color)} />
          </>
        )}
        <span className="truncate text-foreground/80">{node.name}</span>
      </div>

      {is_dir && is_expanded && node.children && (
        <FileNodeList
          nodes={node.children}
          depth={depth + 1}
          expanded_dirs={expanded_dirs}
          onToggle={onToggle}
          onFileClick={onFileClick}
        />
      )}
    </>
  );
}

function FileNodeList({
  nodes,
  depth,
  expanded_dirs,
  onToggle,
  onFileClick,
}: {
  nodes: FileTreeNode[];
  depth: number;
  expanded_dirs: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
}) {
  // Sort: directories first, then files, alphabetical
  const sorted = [...nodes].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      {sorted.map((node) => (
        <FileNodeItem
          key={node.path}
          node={node}
          depth={depth}
          expanded_dirs={expanded_dirs}
          onToggle={onToggle}
          onFileClick={onFileClick}
        />
      ))}
    </>
  );
}

export default function WorkspaceFileBrowser({
  selectedProject,
}: WorkspaceFileBrowserProps) {
  const { t } = useTranslation('sidebar');
  const { files, loading, refreshFiles } = useFileTreeData(selectedProject);
  const [expanded_dirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const ShowToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const {
    isDragOver,
    operationLoading,
    treeRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useFileTreeUpload({
    selectedProject,
    onRefresh: refreshFiles,
    showToast: ShowToast,
  });

  // Check if a drag event is from an external source (OS files), not internal file-to-chat drags
  const IsExternalFileDrag = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    // External OS file drops have "Files" type; internal drags have our custom MIME type
    return types.includes('Files') && !types.includes('application/x-file-reference');
  }, []);

  // Wrap upload handlers to only activate for external file drops
  const HandleUploadDragEnter = useCallback((e: React.DragEvent) => {
    if (!IsExternalFileDrag(e)) return;
    handleDragEnter(e);
  }, [IsExternalFileDrag, handleDragEnter]);

  const HandleUploadDragOver = useCallback((e: React.DragEvent) => {
    if (!IsExternalFileDrag(e)) return;
    handleDragOver(e);
  }, [IsExternalFileDrag, handleDragOver]);

  const HandleUploadDrop = useCallback((e: React.DragEvent) => {
    if (!IsExternalFileDrag(e)) return;
    handleDrop(e);
  }, [IsExternalFileDrag, handleDrop]);

  const HandleToggle = useCallback((dir_path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir_path)) {
        next.delete(dir_path);
      } else {
        next.add(dir_path);
      }
      return next;
    });
  }, []);

  const HandleFileClick = useCallback((file_path: string) => {
    window.dispatchEvent(
      new CustomEvent('workspace-file-open', { detail: { filePath: file_path } }),
    );
  }, []);

  if (!selectedProject) return null;

  return (
    <div className="flex flex-col border-t border-border/40">
      <button
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <FolderOpen className="h-3.5 w-3.5" />
        <span>{t('fileBrowser.title', { defaultValue: 'Files' })}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          {t('fileBrowser.dragHint', { defaultValue: 'drag to chat' })}
        </span>
      </button>

      {!collapsed && (
        <div
          ref={treeRef}
          onDragEnter={HandleUploadDragEnter}
          onDragOver={HandleUploadDragOver}
          onDragLeave={handleDragLeave}
          onDrop={HandleUploadDrop}
          className={cn(
            'relative transition-colors duration-150',
            isDragOver && 'rounded-lg border-2 border-dashed border-primary/50 bg-primary/5',
          )}
        >
          {/* Upload drop overlay */}
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10">
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-5 w-5 text-primary" />
                <span className="text-[11px] font-medium text-primary">
                  {t('fileBrowser.dropToUpload', { defaultValue: 'Drop to upload' })}
                </span>
              </div>
            </div>
          )}

          {/* Upload loading indicator */}
          {operationLoading && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5">
              <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
              <span className="text-[11px] text-muted-foreground">
                {t('fileBrowser.uploading', { defaultValue: 'Uploading...' })}
              </span>
            </div>
          )}

          {/* Toast notification */}
          {toast && (
            <div className={cn(
              'mx-2 mb-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
              toast.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 text-destructive',
            )}>
              {toast.type === 'success' ? (
                <Check className="h-3 w-3 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              )}
              <span className="truncate">{toast.message}</span>
            </div>
          )}

          <ScrollArea className="max-h-[40vh] overflow-y-auto px-1 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
            ) : files.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                {t('fileBrowser.empty', { defaultValue: 'No files found' })}
              </p>
            ) : (
              <FileNodeList
                nodes={files}
                depth={0}
                expanded_dirs={expanded_dirs}
                onToggle={HandleToggle}
                onFileClick={HandleFileClick}
              />
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
