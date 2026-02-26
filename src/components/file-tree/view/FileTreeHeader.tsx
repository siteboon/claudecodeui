import { Eye, FileText, FolderPlus, List, RefreshCw, Search, TableProperties, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { FileTreeViewMode } from '../types/types';

type FileTreeHeaderProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onRefresh?: () => void;
};

export default function FileTreeHeader({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onNewFile,
  onNewFolder,
  onRefresh,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
        <div className="flex gap-0.5">
          {(onNewFile || onNewFolder || onRefresh) && (
            <div className="flex gap-0.5 mr-1 pr-1 border-r border-border">
              {onNewFile && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onNewFile}
                  title={t('fileTree.newFile', 'New File')}
                >
                  <FileText className="w-3.5 h-3.5" />
                </Button>
              )}
              {onNewFolder && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onNewFolder}
                  title={t('fileTree.newFolder', 'New Folder')}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
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
            </div>
          )}
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

