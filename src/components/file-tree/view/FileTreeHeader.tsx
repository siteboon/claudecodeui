import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { ChevronDown, Eye, FileText, FolderPlus, List, Loader2, RefreshCw, Search, TableProperties, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';
import { MAX_FILE_UPLOAD_SIZE_LABEL } from '../constants/constants';
import type { FileTreeViewMode } from '../types/types';

type FileTreeHeaderProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  // Toolbar actions
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onUploadFiles?: (files: FileList) => void;
  onRefresh?: () => void;
  onCollapseAll?: () => void;
  // Loading state
  loading?: boolean;
  operationLoading?: boolean;
  isUploading?: boolean;
  uploadProgress?: number | null;
};

export default function FileTreeHeader({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onNewFile,
  onNewFolder,
  onUploadFiles,
  onRefresh,
  onCollapseAll,
  loading,
  operationLoading,
  isUploading,
  uploadProgress,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files && files.length > 0) {
      onUploadFiles?.(files);
    }
    event.target.value = '';
  };

  return (
    <div className="space-y-2 border-b border-border px-3 pb-2 pt-3">
      {/* Title and Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
        <div className="flex items-center gap-0.5">
          {/* Action buttons */}
          {onUploadFiles && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleUploadInputChange}
                tabIndex={-1}
                aria-hidden="true"
              />
              <Button
                variant="ghost"
                size="sm"
                className="relative h-7 w-7 p-0"
                onClick={() => uploadInputRef.current?.click()}
                title={
                  isUploading
                    ? t('fileTree.uploadingFiles', 'Uploading files')
                    : t('fileTree.uploadFiles', 'Upload files (max {{size}} each)', {
                        size: MAX_FILE_UPLOAD_SIZE_LABEL,
                      })
                }
                aria-label={t('fileTree.uploadFiles', 'Upload files (max {{size}} each)', {
                  size: MAX_FILE_UPLOAD_SIZE_LABEL,
                })}
                disabled={operationLoading}
              >
                {isUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {isUploading && typeof uploadProgress === 'number' && (
                  <span className="absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 overflow-hidden rounded-full bg-primary/20">
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </span>
                )}
              </Button>
            </>
          )}
          {onNewFile && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onNewFile}
              title={t('fileTree.newFile', 'New File (Cmd+N)')}
              aria-label={t('fileTree.newFile', 'New File (Cmd+N)')}
              disabled={operationLoading}
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
          )}
          {onNewFolder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onNewFolder}
              title={t('fileTree.newFolder', 'New Folder (Cmd+Shift+N)')}
              aria-label={t('fileTree.newFolder', 'New Folder (Cmd+Shift+N)')}
              disabled={operationLoading}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onRefresh}
              title={t('fileTree.refresh', 'Refresh')}
              aria-label={t('fileTree.refresh', 'Refresh')}
              disabled={operationLoading}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
          )}
          {onCollapseAll && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onCollapseAll}
              title={t('fileTree.collapseAll', 'Collapse All')}
              aria-label={t('fileTree.collapseAll', 'Collapse All')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* Divider */}
          <div className="mx-0.5 h-4 w-px bg-border" />
          {/* View mode buttons */}
          <Button
            variant={viewMode === 'simple' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('simple')}
            title={t('fileTree.simpleView')}
            aria-label={t('fileTree.simpleView')}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'compact' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('compact')}
            title={t('fileTree.compactView')}
            aria-label={t('fileTree.compactView')}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'detailed' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('detailed')}
            title={t('fileTree.detailedView')}
            aria-label={t('fileTree.detailedView')}
          >
            <TableProperties className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('fileTree.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="h-8 pl-8 pr-8 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 h-5 w-5 -translate-y-1/2 p-0 hover:bg-accent"
            onClick={() => onSearchQueryChange('')}
            title={t('fileTree.clearSearch')}
            aria-label={t('fileTree.clearSearch')}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
