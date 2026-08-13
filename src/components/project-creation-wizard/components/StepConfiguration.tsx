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
  useManualGithubUrlEntry: boolean;
  onWorkspacePathChange: (workspacePath: string) => void;
  onGithubUrlChange: (githubUrl: string) => void;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
  onUseManualGithubUrlEntryChange: (useManual: boolean) => void;
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
  useManualGithubUrlEntry,
  onWorkspacePathChange,
  onGithubUrlChange,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
  onUseManualGithubUrlEntryChange,
  onAdvanceToConfirm,
}: StepConfigurationProps) {
  const { t } = useTranslation();
  const showGithubAuth = shouldShowGithubAuthentication(githubUrl);
  const showRepoPicker = !loadingTokens && availableTokens.length > 0 && !useManualGithubUrlEntry;

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
            tokenId={selectedGithubToken}
            availableTokens={availableTokens}
            disabled={isCreating}
            onSelectRepo={onGithubUrlChange}
            onTokenChange={onSelectedGithubTokenChange}
            onUseManualUrl={() => onUseManualGithubUrlEntryChange(true)}
          />
        ) : (
          <>
            <Input
              type="text"
              value={githubUrl}
              onChange={(event) => onGithubUrlChange(event.target.value)}
              placeholder="https://github.com/username/repository"
              className="w-full"
              disabled={isCreating}
            />
            {!loadingTokens && availableTokens.length > 0 && (
              <button
                type="button"
                onClick={() => onUseManualGithubUrlEntryChange(false)}
                className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('projectWizard.step2.searchRepositories')}
              </button>
            )}
          </>
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
