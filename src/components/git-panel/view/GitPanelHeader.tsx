import { Check, ChevronDown, Download, GitBranch, Plus, RefreshCw, Upload } from 'lucide-react';
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
  onRefresh: () => void;
  onSwitchBranch: (branchName: string) => Promise<boolean>;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onFetch: () => Promise<void>;
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
  onPublish: () => Promise<void>;
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
  onRefresh,
  onSwitchBranch,
  onCreateBranch,
  onFetch,
  onPull,
  onPush,
  onPublish,
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

  const aheadCount = remoteStatus?.ahead || 0;
  const behindCount = remoteStatus?.behind || 0;
  const remoteName = remoteStatus?.remoteName || 'remote';
  const shouldShowFetchButton = aheadCount > 0 && behindCount > 0;

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

  const handleSwitchBranch = async (branchName: string) => {
    const success = await onSwitchBranch(branchName);
    if (success) {
      setShowBranchDropdown(false);
    }
  };

  return (
    <>
      <div className={`flex items-center justify-between border-b border-border/60 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowBranchDropdown((previous) => !previous)}
            className={`flex items-center hover:bg-accent rounded-lg transition-colors ${isMobile ? 'space-x-1 px-2 py-1' : 'space-x-2 px-3 py-1.5'}`}
          >
            <GitBranch className={`text-muted-foreground ${isMobile ? 'w-3 h-3' : 'w-4 h-4'}`} />
            <span className="flex items-center gap-1">
              <span className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{currentBranch}</span>
              {remoteStatus?.hasRemote && (
                <span className="flex items-center gap-1 text-xs">
                  {aheadCount > 0 && (
                    <span
                      className="text-green-600 dark:text-green-400"
                      title={`${aheadCount} commit${aheadCount !== 1 ? 's' : ''} ahead`}
                    >
                      {'\u2191'}
                      {aheadCount}
                    </span>
                  )}
                  {behindCount > 0 && (
                    <span
                      className="text-primary"
                      title={`${behindCount} commit${behindCount !== 1 ? 's' : ''} behind`}
                    >
                      {'\u2193'}
                      {behindCount}
                    </span>
                  )}
                  {remoteStatus.isUpToDate && (
                    <span className="text-muted-foreground" title="Up to date with remote">
                      {'\u2713'}
                    </span>
                  )}
                </span>
              )}
            </span>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showBranchDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-card rounded-xl shadow-lg border border-border z-50 overflow-hidden">
              <div className="py-1 max-h-64 overflow-y-auto">
                {branches.map((branch) => (
                  <button
                    key={branch}
                    onClick={() => void handleSwitchBranch(branch)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors ${
                      branch === currentBranch ? 'bg-accent/50 text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      {branch === currentBranch && <Check className="w-3 h-3 text-primary" />}
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
                  className="w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-center space-x-2"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create new branch</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
          {remoteStatus?.hasRemote && (
            <>
              {!remoteStatus.hasUpstream && (
                <button
                  onClick={requestPublishConfirmation}
                  disabled={isPublishing}
                  className="px-2.5 py-1 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1 transition-colors"
                  title={`Publish branch "${currentBranch}" to ${remoteName}`}
                >
                  <Upload className={`w-3 h-3 ${isPublishing ? 'animate-pulse' : ''}`} />
                  <span>{isPublishing ? 'Publishing...' : 'Publish'}</span>
                </button>
              )}

              {remoteStatus.hasUpstream && !remoteStatus.isUpToDate && (
                <>
                  {behindCount > 0 && (
                    <button
                      onClick={requestPullConfirmation}
                      disabled={isPulling}
                      className="px-2.5 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1 transition-colors"
                      title={`Pull ${behindCount} commit${behindCount !== 1 ? 's' : ''} from ${remoteName}`}
                    >
                      <Download className={`w-3 h-3 ${isPulling ? 'animate-pulse' : ''}`} />
                      <span>{isPulling ? 'Pulling...' : `Pull ${behindCount}`}</span>
                    </button>
                  )}

                  {aheadCount > 0 && (
                    <button
                      onClick={requestPushConfirmation}
                      disabled={isPushing}
                      className="px-2.5 py-1 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1 transition-colors"
                      title={`Push ${aheadCount} commit${aheadCount !== 1 ? 's' : ''} to ${remoteName}`}
                    >
                      <Upload className={`w-3 h-3 ${isPushing ? 'animate-pulse' : ''}`} />
                      <span>{isPushing ? 'Pushing...' : `Push ${aheadCount}`}</span>
                    </button>
                  )}

                  {shouldShowFetchButton && (
                    <button
                      onClick={() => void onFetch()}
                      disabled={isFetching}
                      className="px-2.5 py-1 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1 transition-colors"
                      title={`Fetch from ${remoteName}`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                      <span>{isFetching ? 'Fetching...' : 'Fetch'}</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={`hover:bg-accent rounded-lg transition-colors ${isMobile ? 'p-1' : 'p-1.5'}`}
            title="Refresh git status"
          >
            <RefreshCw className={`text-muted-foreground ${isLoading ? 'animate-spin' : ''} ${isMobile ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>
        </div>
      </div>

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
