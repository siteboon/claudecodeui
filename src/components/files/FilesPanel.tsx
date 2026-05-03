import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, ChevronRight, ChevronDown, Upload } from 'lucide-react';
import type { FileEntry } from './types';

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function flattenFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.children) result.push(...flattenFiles(entry.children));
  }
  return result;
}

function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  const lower = query.toLowerCase();
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'directory') {
      const filteredChildren = entry.children ? filterTree(entry.children, query) : [];
      if (filteredChildren.length > 0 || entry.name.toLowerCase().includes(lower)) {
        result.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(lower)) {
      result.push(entry);
    }
  }
  return result;
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileSelect?: (path: string) => void;
}

function FileTreeNode({ entry, depth, expanded, onToggle, onFileSelect }: FileTreeNodeProps) {
  const isDir = entry.type === 'directory';
  const isExpanded = expanded.has(entry.path);

  const handleClick = () => {
    if (isDir) {
      onToggle(entry.path);
    } else {
      onFileSelect?.(entry.path);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-secondary/50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {isDir ? (
          <span data-icon="folder" className="text-amber-500">&#128193;</span>
        ) : (
          <span data-icon="file" className="text-muted-foreground">&#128196;</span>
        )}
        <span className="flex-1 truncate text-foreground">{entry.name}</span>
        {!isDir && entry.size != null && (
          <span className="shrink-0 text-xs text-muted-foreground">{formatSize(entry.size)}</span>
        )}
      </button>
      {isDir && isExpanded && entry.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onFileSelect={onFileSelect}
        />
      ))}
    </>
  );
}

interface FilesPanelComponentProps {
  projectPath: string;
  isOpen: boolean;
  onClose: () => void;
  files: FileEntry[];
  onFileSelect?: (path: string) => void;
  onUpload?: (files: File[]) => void;
}

export default function FilesPanel({
  isOpen,
  onClose,
  files,
  onFileSelect,
}: FilesPanelComponentProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const filteredFiles = useMemo(
    () => (search ? filterTree(files, search) : files),
    [files, search],
  );

  const allFlat = useMemo(() => flattenFiles(filteredFiles), [filteredFiles]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">{t('files.title')}</span>
        <button
          type="button"
          aria-label={t('files.close')}
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('files.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {allFlat.length === 0 && search ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('files.noResults')}
          </div>
        ) : (
          filteredFiles.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              onToggle={handleToggle}
              onFileSelect={onFileSelect}
            />
          ))
        )}
      </div>

      {/* Upload drop zone */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-xs text-muted-foreground">
          <Upload className="h-3.5 w-3.5" />
          <span>{t('files.dropToUpload')}</span>
        </div>
      </div>
    </div>
  );
}
