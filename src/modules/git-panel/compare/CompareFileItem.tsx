import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GitBranchDiffFile } from '@/shared/types';
import { getStatusBadgeClass, getStatusLabelKey } from '@/modules/git-panel/utils/gitPanelUtils';
import GitDiffViewer from '@/modules/git-panel/GitDiffViewer';

type CompareFileItemProps = {
  file: GitBranchDiffFile;
  isMobile: boolean;
  isExpanded: boolean;
  /** Unified diff once loaded; undefined while loading or after a failed load. */
  diff?: string;
  /** Why the diff could not be loaded, shown in place of it. */
  loadError?: string;
  wrapText: boolean;
  onToggleExpanded: (file: GitBranchDiffFile) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
};

/** Rendered by CompareView for one file that differs from the compare base, with its status badge and expandable diff. */
export default function CompareFileItem({
  file,
  isMobile,
  isExpanded,
  diff,
  loadError,
  wrapText,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
}: CompareFileItemProps) {
  const { t } = useTranslation();
  const statusLabel = t(getStatusLabelKey(file.status));
  const badgeClass = getStatusBadgeClass(file.status);
  const renamedFrom = file.oldPath ? t('git:compare.renamedFrom', { path: file.oldPath }) : null;
  // A rename with no hunks is a pure rename, which is worth saying explicitly
  // rather than showing the generic "no diff" placeholder.
  const isRenameOnly = file.status === 'R' && diff === '';

  return (
    <div className="border-b border-border last:border-0">
      <div className={`flex items-center transition-colors hover:bg-accent/50 ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <div className="flex min-w-0 flex-1 items-center">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(file);
            }}
            className={`cursor-pointer rounded p-0.5 hover:bg-accent ${isMobile ? 'mr-1' : 'mr-2'}`}
            title={isExpanded ? t('git:item.collapseDiff') : t('git:item.expandDiff')}
            aria-expanded={isExpanded}
          >
            <ChevronRight className={`h-3 w-3 transition-transform duration-200 ease-in-out ${isExpanded ? 'rotate-90' : 'rotate-0'}`} />
          </button>

          <span
            className={`flex min-w-0 flex-1 flex-col ${isMobile ? 'text-xs' : 'text-sm'} cursor-pointer hover:text-primary hover:underline`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(file.path);
            }}
            title={t('git:item.openFileTitle')}
          >
            <span className="truncate">{file.path}</span>
            {renamedFrom && (
              <span className="truncate text-[11px] italic text-muted-foreground">{renamedFrom}</span>
            )}
          </span>

          <span
            className={`ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${badgeClass}`}
            title={statusLabel}
          >
            {file.status}
          </span>
        </div>
      </div>

      {/* No translate here: a transform transition on the last row leaves its
          nested diff scroller unpainted in Chromium once the animation ends. */}
      <div
        className={`overflow-hidden bg-muted/50 transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border p-2">
          <span className="flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${badgeClass}`}>
              {file.status}
            </span>
            <span className="text-sm font-medium text-foreground">{statusLabel}</span>
          </span>
          {isMobile && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onToggleWrapText();
              }}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              title={wrapText ? t('git:item.switchToScroll') : t('git:item.switchToWrap')}
            >
              {wrapText ? t('git:item.scroll') : t('git:item.wrap')}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loadError !== undefined ? (
            <div className="flex items-start gap-2 p-3 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive/70" />
              <span className="min-w-0 break-words">
                <span className="font-medium text-foreground">{t('git:compare.fileLoadError')}</span>
                {' '}
                {loadError}
              </span>
            </div>
          ) : diff === undefined ? (
            // Only animate while visible; a hidden spinner would keep the compositor busy.
            isExpanded && (
              <div className="flex h-16 items-center justify-center">
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )
          ) : isRenameOnly ? (
            <div className="p-4 text-center text-sm text-muted-foreground">{t('git:compare.renameOnly')}</div>
          ) : (
            <GitDiffViewer diff={diff} isMobile={isMobile} wrapText={wrapText} />
          )}
        </div>
      </div>
    </div>
  );
}
