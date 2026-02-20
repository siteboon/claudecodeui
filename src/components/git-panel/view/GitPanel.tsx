import { useCallback, useState } from 'react';
import { useGitPanelController } from '../hooks/useGitPanelController';
import type { ConfirmationRequest, GitPanelProps, GitPanelView } from '../types/types';
import ChangesView from '../view/changes/ChangesView';
import HistoryView from '../view/history/HistoryView';
import GitPanelHeader from '../view/GitPanelHeader';
import GitRepositoryErrorState from '../view/GitRepositoryErrorState';
import GitViewTabs from '../view/GitViewTabs';
import ConfirmActionModal from '../view/modals/ConfirmActionModal';

export default function GitPanel({ selectedProject, isMobile = false, onFileOpen }: GitPanelProps) {
  const [activeView, setActiveView] = useState<GitPanelView>('changes');
  const [wrapText, setWrapText] = useState(true);
  const [hasExpandedFiles, setHasExpandedFiles] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmationRequest | null>(null);

  const {
    gitStatus,
    gitDiff,
    isLoading,
    currentBranch,
    branches,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch,
    isFetching,
    isPulling,
    isPushing,
    isPublishing,
    isCreatingInitialCommit,
    refreshAll,
    switchBranch,
    createBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    discardChanges,
    deleteUntrackedFile,
    fetchCommitDiff,
    generateCommitMessage,
    commitChanges,
    createInitialCommit,
    openFile,
  } = useGitPanelController({
    selectedProject,
    activeView,
    onFileOpen,
  });

  const executeConfirmedAction = useCallback(async () => {
    if (!confirmAction) {
      return;
    }

    const actionToExecute = confirmAction;
    setConfirmAction(null);

    try {
      await actionToExecute.onConfirm();
    } catch (error) {
      console.error('Error executing confirmation action:', error);
    }
  }, [confirmAction]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Select a project to view source control</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <GitPanelHeader
        isMobile={isMobile}
        currentBranch={currentBranch}
        branches={branches}
        remoteStatus={remoteStatus}
        isLoading={isLoading}
        isCreatingBranch={isCreatingBranch}
        isFetching={isFetching}
        isPulling={isPulling}
        isPushing={isPushing}
        isPublishing={isPublishing}
        onRefresh={refreshAll}
        onSwitchBranch={switchBranch}
        onCreateBranch={createBranch}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onPublish={handlePublish}
        onRequestConfirmation={setConfirmAction}
      />

      {gitStatus?.error ? (
        <GitRepositoryErrorState error={gitStatus.error} details={gitStatus.details} />
      ) : (
        <>
          <GitViewTabs
            activeView={activeView}
            isHidden={hasExpandedFiles}
            onChange={setActiveView}
          />

          {activeView === 'changes' && (
            <ChangesView
              isMobile={isMobile}
              gitStatus={gitStatus}
              gitDiff={gitDiff}
              isLoading={isLoading}
              wrapText={wrapText}
              isCreatingInitialCommit={isCreatingInitialCommit}
              onWrapTextChange={setWrapText}
              onCreateInitialCommit={createInitialCommit}
              onOpenFile={openFile}
              onDiscardFile={discardChanges}
              onDeleteFile={deleteUntrackedFile}
              onCommitChanges={commitChanges}
              onGenerateCommitMessage={generateCommitMessage}
              onRequestConfirmation={setConfirmAction}
              onExpandedFilesChange={setHasExpandedFiles}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              isMobile={isMobile}
              isLoading={isLoading}
              recentCommits={recentCommits}
              commitDiffs={commitDiffs}
              wrapText={wrapText}
              onFetchCommitDiff={fetchCommitDiff}
            />
          )}
        </>
      )}

      <ConfirmActionModal
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          void executeConfirmedAction();
        }}
      />
    </div>
  );
}
