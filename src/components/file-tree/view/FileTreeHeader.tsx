import { Eye, FileText, FolderPlus, List, MinusSquare, RefreshCw, Search, TableProperties, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { FileTreeViewMode } from '../types/types';

type FileTreeHeaderProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  // Toolbar actions
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onRefresh?: () => void;
  onCollapseAll?: () => void;
};

export default function FileTreeHeader({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
        <div className="flex gap-0.5">
          <Button
            variant={viewMode === 'simple' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('simple')}
            title={t('fileTree.simpleView')}
          >
            <List className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={viewMode === 'compact' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('compact')}
            title={t('fileTree.compactView')}
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={viewMode === 'detailed' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('detailed')}
            title={t('fileTree.detailedView')}
          >
            <TableProperties className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Toolbar buttons */}
      <div className="flex items-center gap-1">
        {onNewFile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={onNewFile}
            title={`${t('fileTree.newFile', 'New File')} (⌘N)`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('fileTree.newFile', 'New File')}</span>
          </Button>
        )}
        {onNewFolder && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={onNewFolder}
            title={`${t('fileTree.newFolder', 'New Folder')} (⇧⌘N)`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('fileTree.newFolder', 'New Folder')}</span>
          </Button>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onRefresh}
            title={t('fileTree.refresh', 'Refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        )}
        {onCollapseAll && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onCollapseAll}
            title={t('fileTree.collapseAll', 'Collapse All')}
          >
            <MinusSquare className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('fileTree.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-8 pr-8 h-8 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
            onClick={() => onSearchQueryChange('')}
            title={t('fileTree.clearSearch')}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
