import { GitBranch, GitCommit, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  onStageFiles: (files: string[]) => Promise<boolean>;
  onUnstageFiles: (files: string[]) => Promise<boolean>;
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
  onStageFiles,
  onUnstageFiles,
  onCommitChanges,
  onGenerateCommitMessage,
  onRequestConfirmation,
  onExpandedFilesChange,
}: ChangesViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const { t } = useTranslation('common');
  // Stage/unstage calls in flight or queued. While > 0, status refreshes must
  // not overwrite the optimistic selection with a snapshot that predates the
  // later clicks.
  const [pendingStageOps, setPendingStageOps] = useState(0);
  // Serializes stage/unstage requests so rapid toggles cannot interleave on
  // the server or resolve out of order.
  const stageOpQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const changedFiles = useMemo(() => getAllChangedFiles(gitStatus), [gitStatus]);
  const hasExpandedFiles = expandedFiles.size > 0;

  const enqueueStageOp = useCallback((operation: () => Promise<unknown>) => {
    setPendingStageOps((count) => count + 1);
    stageOpQueueRef.current = stageOpQueueRef.current
      .catch(() => {}) // a failed op must not block the queue
      .then(operation)
      .finally(() => setPendingStageOps((count) => count - 1));
  }, []);

  useEffect(() => {
    if (!gitStatus || gitStatus.error) {
      setSelectedFiles(new Set());
      return;
    }

    if (pendingStageOps > 0) {
      return; // keep the optimistic state until the queued ops settle
    }

    // The Staged section mirrors the real git index reported by /status, so
    // files staged outside the app (VSCode, terminal) show up here too. Also
    // re-runs when the queue drains, syncing to the final refreshed status.
    setSelectedFiles(new Set(gitStatus.staged ?? []));
  }, [gitStatus, pendingStageOps]);

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

  // Staging is real: every toggle runs git add / git reset through the API.
  // The set is flipped optimistically; the queued API call keeps the git
  // index in sync and the final status refresh re-syncs once the queue drains.
  const toggleFileSelected = useCallback(
    (filePath: string) => {
      const isStaged = selectedFiles.has(filePath);
      setSelectedFiles((previous) => {
        const next = new Set(previous);
        if (isStaged) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      });
      enqueueStageOp(() => (isStaged ? onUnstageFiles([filePath]) : onStageFiles([filePath])));
    },
    [enqueueStageOp, onStageFiles, onUnstageFiles, selectedFiles],
  );

  const requestFileAction = useCallback(
    (filePath: string, status: FileStatusCode) => {
      if (status === 'U') {
        onRequestConfirmation({
          type: 'delete',
          message: t('gitPanel.action.deleteUntrackedConfirm', { file: filePath }),
          onConfirm: async () => {
            await onDeleteFile(filePath);
          },
        });
        return;
      }

      onRequestConfirmation({
        type: 'discard',
        message: t('gitPanel.action.discardConfirm', { file: filePath }),
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
              This repository doesn&apos;t have any commits yet. Create your first commit to start tracking changes.
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('gitPanel.changes.staged')} ({selectedFiles.size})
              </span>
              {selectedFiles.size > 0 && (
                <button
                  onClick={() => {
                    const filesToUnstage = Array.from(selectedFiles);
                    setSelectedFiles(new Set());
                    enqueueStageOp(() => onUnstageFiles(filesToUnstage));
                  }}
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('gitPanel.changes.changes')} ({unstagedFiles.size})
              </span>
              {unstagedFiles.size > 0 && (
                <button
                  onClick={() => {
                    const filesToStage = Array.from(unstagedFiles);
                    setSelectedFiles(new Set(changedFiles));
                    enqueueStageOp(() => onStageFiles(filesToStage));
                  }}
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
