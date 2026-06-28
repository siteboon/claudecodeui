import { GitBranch, GitCommit, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConfirmationRequest, FileStatusCode, GitDiffMap, GitStatusResponse } from '../../types/types';
import { getAllChangedFiles, hasChangedFiles } from '../../utils/gitPanelUtils';
import CommitComposer from './CommitComposer';
import FileChangeList from './FileChangeList';
import FileStatusLegend from './FileStatusLegend';

type ChangesViewProps = {
  isMobile: boolean;
  projectPath: string;
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  wrapText: boolean;
  isCreatingInitialCommit: boolean;
  onWrapTextChange: (wrapText: boolean) => void;
  onCreateInitialCommit: () => Promise<boolean>;
  onOpenFile: (filePath: string) => Promise<void>;
  onDiscardFile: (filePath: string) => Promise<void>;
  onDeleteFile: (filePath: string) => Promise<void>;
  onCommitChanges: (message: string, files: string[]) => Promise<boolean>;
  onGenerateCommitMessage: (files: string[]) => Promise<string | null>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
  onExpandedFilesChange: (hasExpandedFiles: boolean) => void;
};

export default function ChangesView({
  isMobile,
  projectPath,
  gitStatus,
  gitDiff,
  isLoading,
  wrapText,
  isCreatingInitialCommit,
  onWrapTextChange,
  onCreateInitialCommit,
  onOpenFile,
  onDiscardFile,
  onDeleteFile,
  onCommitChanges,
  onGenerateCommitMessage,
  onRequestConfirmation,
  onExpandedFilesChange,
}: ChangesViewProps) {
  const { t } = useTranslation('common');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const changedFiles = useMemo(() => getAllChangedFiles(gitStatus), [gitStatus]);
  const hasExpandedFiles = expandedFiles.size > 0;

  useEffect(() => {
    if (!gitStatus || gitStatus.error) {
      setSelectedFiles(new Set());
      return;
    }

    // Remove any selected files that no longer exist in the status
    setSelectedFiles((prev) => {
      const allFiles = new Set(getAllChangedFiles(gitStatus));
      const next = new Set([...prev].filter((f) => allFiles.has(f)));
      return next;
    });
  }, [gitStatus]);

  useEffect(() => {
    onExpandedFilesChange(hasExpandedFiles);
  }, [hasExpandedFiles, onExpandedFilesChange]);

  useEffect(() => {
    return () => {
      onExpandedFilesChange(false);
    };
  }, [onExpandedFilesChange]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const toggleFileSelected = useCallback((filePath: string) => {
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const requestFileAction = useCallback(
    (filePath: string, status: FileStatusCode) => {
      if (status === 'U') {
        onRequestConfirmation({
          type: 'delete',
          message: `Delete untracked file "${filePath}"? This action cannot be undone.`,
          onConfirm: async () => {
            await onDeleteFile(filePath);
          },
        });
        return;
      }

      onRequestConfirmation({
        type: 'discard',
        message: `Discard all changes to "${filePath}"? This action cannot be undone.`,
        onConfirm: async () => {
          await onDiscardFile(filePath);
        },
      });
    },
    [onDeleteFile, onDiscardFile, onRequestConfirmation],
  );

  const commitSelectedFiles = useCallback(
    (message: string) => {
      return onCommitChanges(message, Array.from(selectedFiles));
    },
    [onCommitChanges, selectedFiles],
  );

  const generateMessageForSelection = useCallback(() => {
    return onGenerateCommitMessage(Array.from(selectedFiles));
  }, [onGenerateCommitMessage, selectedFiles]);

  const unstagedFiles = useMemo(
    () => new Set(changedFiles.filter((f) => !selectedFiles.has(f))),
    [changedFiles, selectedFiles],
  );

  return (
    <>
      <CommitComposer
        isMobile={isMobile}
        projectPath={projectPath}
        selectedFileCount={selectedFiles.size}
        isHidden={hasExpandedFiles}
        onCommit={commitSelectedFiles}
        onGenerateMessage={generateMessageForSelection}
        onRequestConfirmation={onRequestConfirmation}
      />

      {!gitStatus?.error && <FileStatusLegend isMobile={isMobile} />}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : gitStatus?.hasCommits === false ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <GitBranch className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">{t('gitPanel.changes.noCommitsYet')}</h3>
            <p className="mb-6 max-w-md text-sm text-muted-foreground">
              {t('gitPanel.changes.noCommitsDesc')}
            </p>
            <button
              onClick={() => void onCreateInitialCommit()}
              disabled={isCreatingInitialCommit}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingInitialCommit ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>{t('gitPanel.changes.creatingInitialCommit')}</span>
                </>
              ) : (
                <>
                  <GitCommit className="h-4 w-4" />
                  <span>{t('gitPanel.changes.createInitialCommit')}</span>
                </>
              )}
            </button>
          </div>
        ) : !gitStatus || !hasChangedFiles(gitStatus) ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCommit className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">{t('gitPanel.changes.noChangesDetected')}</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            {/* STAGED section */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                {t('gitPanel.changes.staged')} ({selectedFiles.size})
              </span>
              {selectedFiles.size > 0 && (
                <button
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-xs text-primary transition-colors hover:text-primary/80"
                >
                  {t('gitPanel.changes.unstageAll')}
                </button>
              )}
            </div>
            {selectedFiles.size === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">{t('gitPanel.changes.noStagedFiles')}</div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={selectedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}

            {/* CHANGES section */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                {t('gitPanel.changes.changes')} ({unstagedFiles.size})
              </span>
              {unstagedFiles.size > 0 && (
                <button
                  onClick={() => setSelectedFiles(new Set(changedFiles))}
                  className="text-xs text-primary transition-colors hover:text-primary/80"
                >
                  {t('gitPanel.changes.stageAll')}
                </button>
              )}
            </div>
            {unstagedFiles.size === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">{t('gitPanel.changes.allChangesStaged')}</div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={unstagedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
