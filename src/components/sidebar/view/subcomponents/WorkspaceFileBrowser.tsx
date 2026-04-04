import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  File,
  FolderClosed,
  FolderOpen,
  GripVertical,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useFileTreeData } from '../../../file-tree/hooks/useFileTreeData';
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
}: {
  node: FileTreeNode;
  depth: number;
  expanded_dirs: Set<string>;
  onToggle: (path: string) => void;
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
          if (is_dir) onToggle(node.path);
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
}: {
  nodes: FileTreeNode[];
  depth: number;
  expanded_dirs: Set<string>;
  onToggle: (path: string) => void;
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
        />
      ))}
    </>
  );
}

export default function WorkspaceFileBrowser({
  selectedProject,
}: WorkspaceFileBrowserProps) {
  const { t } = useTranslation('sidebar');
  const { files, loading } = useFileTreeData(selectedProject);
  const [expanded_dirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

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
            />
          )}
        </ScrollArea>
      )}
    </div>
  );
}
