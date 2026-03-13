import { AlertCircle, Check, ChevronDown, Download, GitBranch, Plus, RefreshCw, RotateCcw, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConfirmationRequest, GitRemoteStatus } from '../types/types';
import NewBranchModal from './modals/NewBranchModal';

type GitPanelHeaderProps = {
  isMobile: boolean;
  currentBranch: string;
  branches: string[];
  remoteStatus: GitRemoteStatus | null;
  isLoading: boolean;
  isCreatingBranch: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  isRevertingLocalCommit: boolean;
  operationError: string | null;
  onRefresh: () => void;
  onRevertLocalCommit: () => Promise<void>;
  onSwitchBranch: (branchName: string) => Promise<boolean>;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onFetch: () => Promise<void>;
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
  onPublish: () => Promise<void>;
  onClearError: () => void;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
};

export default function GitPanelHeader({
  isMobile,
  currentBranch,
  branches,
  remoteStatus,
  isLoading,
  isCreatingBranch,
  isFetching,
  isPulling,
  isPushing,
  isPublishing,
  isRevertingLocalCommit,
  operationError,
  onRefresh,
  onRevertLocalCommit,
  onSwitchBranch,
  onCreateBranch,
  onFetch,
  onPull,
  onPush,
  onPublish,
  onClearError,
  onRequestConfirmation,
}: GitPanelHeaderProps) {
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowBranchDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const aheadCount = remoteStatus?.ahead ?? 0;
  const behindCount = remoteStatus?.behind ?? 0;
  const remoteName = remoteStatus?.remoteName ?? 'remote';
  const anyPending = isFetching || isPulling || isPushing || isPublishing;

  const requestPullConfirmation = () => {
    onRequestConfirmation({
      type: 'pull',
      message: `Pull ${behindCount} commit${behindCount !== 1 ? 's' : ''} from ${remoteName}?`,
      onConfirm: onPull,
    });
  };

  const requestPushConfirmation = () => {
    onRequestConfirmation({
      type: 'push',
      message: `Push ${aheadCount} commit${aheadCount !== 1 ? 's' : ''} to ${remoteName}?`,
      onConfirm: onPush,
    });
  };

  const requestPublishConfirmation = () => {
    onRequestConfirmation({
      type: 'publish',
      message: `Publish branch "${currentBranch}" to ${remoteName}?`,
      onConfirm: onPublish,
    });
  };

  const requestRevertLocalCommitConfirmation = () => {
    onRequestConfirmation({
      type: 'revertLocalCommit',
      message: 'Revert the latest local commit? This removes the commit but keeps its changes staged.',
      onConfirm: onRevertLocalCommit,
    });
  };

  const handleSwitchBranch = async (branchName: string) => {
    try {
      const success = await onSwitchBranch(branchName);
      if (success) setShowBranchDropdown(false);
    } catch (error) {
      console.error('[GitPanelHeader] Failed to switch branch:', error);
    }
  };

  return (
    <>
      {/* Branch row + action buttons */}
      <div className={`flex items-center justify-between border-b border-border/60 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'}`}>
        {/* Branch selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowBranchDropdown((prev) => !prev)}
            className={`flex items-center rounded-lg transition-colors hover:bg-accent ${isMobile ? 'space-x-1 px-2 py-1' : 'space-x-2 px-3 py-1.5'}`}
          >
            <GitBranch className={`text-muted-foreground ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
            <span className="flex items-center gap-1">
              <span className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{currentBranch}</span>
              {remoteStatus?.hasRemote && (
                <span className="flex items-center gap-0.5 text-xs">
                  {aheadCount > 0 && (
                    <span className="text-green-600 dark:text-green-400" title={`${aheadCount} ahead`}>
                      ↑{aheadCount}
                    </span>
                  )}
                  {behindCount > 0 && (
                    <span className="text-primary" title={`${behindCount} behind`}>
                      ↓{behindCount}
                    </span>
                  )}
                  {remoteStatus.isUpToDate && (
                    <span className="text-muted-foreground" title="Up to date">✓</span>
                  )}
                </span>
              )}
            </span>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showBranchDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              <div className="max-h-64 overflow-y-auto py-1">
                {branches.map((branch) => (
                  <button
                    key={branch}
                    onClick={() => void handleSwitchBranch(branch)}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      branch === currentBranch ? 'bg-accent/50 text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      {branch === currentBranch && <Check className="h-3 w-3 text-primary" />}
                      <span className={branch === currentBranch ? 'font-medium' : ''}>{branch}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-t border-border py-1">
                <button
                  onClick={() => {
                    setShowNewBranchModal(true);
                    setShowBranchDropdown(false);
                  }}
                  className="flex w-full items-center space-x-2 px-4 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                  <span>Create new branch</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
          {remoteStatus?.hasRemote && (
            <>
              {!remoteStatus.hasUpstream ? (
                <button
                  onClick={requestPublishConfirmation}
                  disabled={anyPending}
                  className="flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                  title={`Publish "${currentBranch}" to ${remoteName}`}
                >
                  <Upload className={`h-3 w-3 ${isPublishing ? 'animate-pulse' : ''}`} />
                  {!isMobile && <span>{isPublishing ? 'Publishing…' : 'Publish'}</span>}
                </button>
              ) : (
                <>
                  {/* Fetch — always visible when remote exists */}
                  <button
                    onClick={() => void onFetch()}
                    disabled={anyPending}
                    className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    title={`Fetch from ${remoteName}`}
                  >
                    <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
                    {!isMobile && <span>{isFetching ? 'Fetching…' : 'Fetch'}</span>}
                  </button>

                  {behindCount > 0 && (
                    <button
                      onClick={requestPullConfirmation}
                      disabled={anyPending}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                      title={`Pull ${behindCount} from ${remoteName}`}
                    >
                      <Download className={`h-3 w-3 ${isPulling ? 'animate-pulse' : ''}`} />
                      {!isMobile && <span>{isPulling ? 'Pulling…' : `Pull ${behindCount}`}</span>}
                    </button>
                  )}

                  {aheadCount > 0 && (
                    <button
                      onClick={requestPushConfirmation}
                      disabled={anyPending}
                      className="flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                      title={`Push ${aheadCount} to ${remoteName}`}
                    >
                      <Upload className={`h-3 w-3 ${isPushing ? 'animate-pulse' : ''}`} />
                      {!isMobile && <span>{isPushing ? 'Pushing…' : `Push ${aheadCount}`}</span>}
                    </button>
                  )}
                </>
              )}
            </>
          )}

          <button
            onClick={requestRevertLocalCommitConfirmation}
            disabled={isRevertingLocalCommit}
            className={`rounded-lg transition-colors hover:bg-accent disabled:opacity-50 ${isMobile ? 'p-1' : 'p-1.5'}`}
            title="Revert latest local commit"
          >
            <RotateCcw
              className={`text-muted-foreground ${isRevertingLocalCommit ? 'animate-pulse' : ''} ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`}
            />
          </button>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={`rounded-lg transition-colors hover:bg-accent ${isMobile ? 'p-1' : 'p-1.5'}`}
            title="Refresh git status"
          >
            <RefreshCw className={`text-muted-foreground ${isLoading ? 'animate-spin' : ''} ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
          </button>
        </div>
      </div>

      {/* Inline error banner */}
      {operationError && (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 leading-snug">{operationError}</span>
          <button
            onClick={onClearError}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/20"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <NewBranchModal
        isOpen={showNewBranchModal}
        currentBranch={currentBranch}
        isCreatingBranch={isCreatingBranch}
        onClose={() => setShowNewBranchModal(false)}
        onCreateBranch={onCreateBranch}
      />
    </>
  );
}
