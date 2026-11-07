import { AlertCircle, GitCompare, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { GitBranchDiffFile, GitStatusResponse } from '@/shared/types';
import { useBranchCompare } from '@/modules/git-panel/hooks/useBranchCompare';
import CompareFileItem from '@/modules/git-panel/compare/CompareFileItem';

type CompareViewProps = {
  projectId: string;
  currentBranch: string;
  localBranches: string[];
  remoteRefs: string[];
  gitStatus: GitStatusResponse | null;
  isMobile: boolean;
  wrapText: boolean;
  onWrapTextChange: (wrapText: boolean) => void;
  onOpenFile: (filePath: string) => Promise<void>;
};

const NO_EXPANDED_FILES: ReadonlySet<string> = new Set();

/** Rendered by GitPanel for the Compare tab: everything the working copy changed relative to a chosen base branch's merge base. */
export default function CompareView({
  projectId,
  currentBranch,
  localBranches,
  remoteRefs,
  gitStatus,
  isMobile,
  wrapText,
  onWrapTextChange,
  onOpenFile,
}: CompareViewProps) {
  const { t } = useTranslation();
  const {
    base,
    setBase,
    files,
    mergeBase,
    isLoading,
    error,
    fileDiffs,
    fileDiffErrors,
    loadFileDiff,
    refresh,
  } = useBranchCompare({ projectId, currentBranch, localBranches, remoteRefs, gitStatus });
  // Rows whose diff is open, tagged with the base they were opened under so a
  // base switch collapses them instead of showing an open row with no diff.
  // Kept here (not in the hook) because it is purely presentational.
  const [expandedState, setExpandedState] = useState<{ base: string; files: Set<string> }>({
    base,
    files: new Set(),
  });
  const expandedFiles = expandedState.base === base ? expandedState.files : NO_EXPANDED_FILES;

  // Picking a base also forgets the rows opened under the previous one; the
  // hook drops their diffs, so restoring them when the user comes back to that
  // base would re-open rows with nothing to show.
  const handleBaseChange = useCallback(
    (nextBase: string) => {
      setExpandedState({ base: nextBase, files: new Set() });
      setBase(nextBase);
    },
    [setBase],
  );

  const toggleFileExpanded = useCallback(
    (file: GitBranchDiffFile) => {
      const isExpanding = !expandedFiles.has(file.path);
      setExpandedState((previous) => {
        const next = new Set(previous.base === base ? previous.files : []);
        if (next.has(file.path)) {
          next.delete(file.path);
        } else {
          next.add(file.path);
        }
        return { base, files: next };
      });

      // Diffs are loaded lazily the first time a row is opened, and re-tried
      // when a row whose load failed is opened again.
      if (isExpanding && fileDiffs[file.path] === undefined) {
        void loadFileDiff(file);
      }
    },
    [base, expandedFiles, fileDiffs, loadFileDiff],
  );

  const hasBases = localBranches.length > 0 || remoteRefs.length > 0;
  // Keep the current list visible during refreshes; only an empty first load
  // gets the spinner, matching the History view.
  const showSpinner = isLoading && files.length === 0 && !error;
  const shortMergeBase = mergeBase ? mergeBase.slice(0, 7) : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <label htmlFor="compare-base-branch" className="shrink-0 text-xs font-medium text-muted-foreground">
          {t('git:compare.baseLabel')}
        </label>
        <select
          id="compare-base-branch"
          value={base}
          disabled={!hasBases}
          onChange={(event) => handleBaseChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        >
          {!hasBases && <option value="">{t('git:compare.noBranches')}</option>}
          {localBranches.length > 0 && (
            <optgroup label={t('git:compare.localGroup')}>
              {localBranches.map((branch) => (
                <option key={`local:${branch}`} value={branch}>
                  {branch}
                </option>
              ))}
            </optgroup>
          )}
          {remoteRefs.length > 0 && (
            <optgroup label={t('git:compare.remoteGroup')}>
              {remoteRefs.map((ref) => (
                <option key={`remote:${ref}`} value={ref}>
                  {ref}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={refresh}
          disabled={!base || isLoading}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title={t('git:compare.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {base && !error && !showSpinner && (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate font-semibold uppercase tracking-wide">
            {/* Ref names are case-sensitive, so the base keeps its own casing. */}
            <Trans
              i18nKey="git:compare.summary"
              count={files.length}
              values={{ base }}
              components={{ ref: <span className="normal-case" /> }}
            />
          </span>
          {shortMergeBase && (
            <span
              className="shrink-0 font-mono"
              title={t('git:compare.mergeBaseTitle', { base, sha: mergeBase })}
            >
              {t('git:compare.mergeBase', { sha: shortMergeBase })}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {showSpinner ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-destructive/70" />
            <p className="text-sm font-medium text-foreground">
              {error.code === 'GIT_NO_MERGE_BASE'
                ? t('git:compare.noCommonHistory', { base })
                : t('git:compare.loadError', { base })}
            </p>
            {error.code !== 'GIT_NO_MERGE_BASE' && (
              <p className="max-w-md break-words text-xs">{error.message}</p>
            )}
          </div>
        ) : !base || files.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCompare className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">{base ? t('git:compare.noChanges', { base }) : t('git:compare.noBranches')}</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            {files.map((file) => (
              <CompareFileItem
                key={file.path}
                file={file}
                isMobile={isMobile}
                isExpanded={expandedFiles.has(file.path)}
                diff={fileDiffs[file.path]}
                loadError={fileDiffErrors[file.path]}
                wrapText={wrapText}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
