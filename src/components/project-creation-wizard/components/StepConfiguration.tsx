import { useTranslation } from 'react-i18next';
import { Input } from '../../../shared/view/ui';
import { shouldShowGithubAuthentication } from '../utils/pathUtils';
import type { GithubTokenCredential, TokenMode } from '../types';
import GithubAuthenticationCard from './GithubAuthenticationCard';
import GithubRepoPicker from './GithubRepoPicker';
import WorkspacePathField from './WorkspacePathField';

type StepConfigurationProps = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GithubTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  isCreating: boolean;
  onWorkspacePathChange: (workspacePath: string) => void;
  onGithubUrlChange: (githubUrl: string) => void;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
  onAdvanceToConfirm: () => void;
};

export default function StepConfiguration({
  workspacePath,
  githubUrl,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  isCreating,
  onWorkspacePathChange,
  onGithubUrlChange,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
  onAdvanceToConfirm,
}: StepConfigurationProps) {
  const { t } = useTranslation();
  const showGithubAuth = shouldShowGithubAuthentication(githubUrl);
  const showRepoPicker = !loadingTokens && availableTokens.length > 0;

  // Searching and cloning are different jobs. Picking "None (Public)" clears
  // the selected token, which is right for the clone but left the search with
  // no credentials at all — the list went dead and claimed "No repositories
  // found for this token". The search falls back to any stored token instead.
  const searchTokenId = selectedGithubToken || String(availableTokens[0]?.id ?? '');

  // The repo was found through an authenticated search, so that same token is
  // the one that can clone it. Without this, picking a repo badged Private
  // while the card sits on "New" or "None (Public)" produces a clone with no
  // usable credentials.
  const handleSelectRepo = (cloneUrl: string) => {
    onGithubUrlChange(cloneUrl);
    onSelectedGithubTokenChange(searchTokenId);
    onTokenModeChange('stored');
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('projectWizard.step2.newPath')}
        </label>

        <WorkspacePathField
          value={workspacePath}
          disabled={isCreating}
          onChange={onWorkspacePathChange}
          onAdvanceToConfirm={onAdvanceToConfirm}
        />

        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('projectWizard.step2.newHelp')}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('projectWizard.step2.githubUrl')}
        </label>

        {showRepoPicker ? (
          <GithubRepoPicker
            value={githubUrl}
            tokenId={searchTokenId}
            availableTokens={availableTokens}
            disabled={isCreating}
            onChange={onGithubUrlChange}
            onSelectRepo={handleSelectRepo}
            onTokenChange={onSelectedGithubTokenChange}
          />
        ) : (
          <Input
            type="text"
            value={githubUrl}
            onChange={(event) => onGithubUrlChange(event.target.value)}
            placeholder="https://github.com/username/repository"
            className="w-full"
            disabled={isCreating}
          />
        )}

        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('projectWizard.step2.githubHelp')}
        </p>
      </div>

      {showGithubAuth && (
        <GithubAuthenticationCard
          tokenMode={tokenMode}
          selectedGithubToken={selectedGithubToken}
          newGithubToken={newGithubToken}
          availableTokens={availableTokens}
          loadingTokens={loadingTokens}
          tokenLoadError={tokenLoadError}
          onTokenModeChange={onTokenModeChange}
          onSelectedGithubTokenChange={onSelectedGithubTokenChange}
          onNewGithubTokenChange={onNewGithubTokenChange}
        />
      )}
    </div>
  );
}
