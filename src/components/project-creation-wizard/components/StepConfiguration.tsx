import { useTranslation } from 'react-i18next';
import { Input } from '../../../shared/view/ui';
import { shouldShowGithubAuthentication } from '../utils/pathUtils';
import type { GithubTokenCredential, TokenMode, WorkspaceType } from '../types';
import GithubAuthenticationCard from './GithubAuthenticationCard';
import WorkspacePathField from './WorkspacePathField';

type StepConfigurationProps = {
  workspaceType: WorkspaceType;
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
  workspaceType,
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
  const showGithubAuth = shouldShowGithubAuthentication(workspaceType, githubUrl);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {workspaceType === 'existing'
            ? t('projectWizard.step2.existingPath')
            : t('projectWizard.step2.newPath')}
        </label>

        <WorkspacePathField
          workspaceType={workspaceType}
          value={workspacePath}
          disabled={isCreating}
          onChange={onWorkspacePathChange}
          onAdvanceToConfirm={onAdvanceToConfirm}
        />

        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {workspaceType === 'existing'
            ? t('projectWizard.step2.existingHelp')
            : t('projectWizard.step2.newHelp')}
        </p>
      </div>

      {workspaceType === 'new' && (
        <>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('projectWizard.step2.githubUrl')}
            </label>
            <Input
              type="text"
              value={githubUrl}
              onChange={(event) => onGithubUrlChange(event.target.value)}
              placeholder="https://github.com/username/repository"
              className="w-full"
              disabled={isCreating}
            />
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
        </>
      )}
    </div>
  );
}
