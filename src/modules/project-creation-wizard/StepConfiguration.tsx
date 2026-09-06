import { useTranslation } from 'react-i18next';

import { Input } from '@/shared/ui';
import { shouldShowGithubAuthentication } from '@/modules/project-creation-wizard/utils/pathUtils';
import type { GitProvider, GitTokenCredential, TokenMode } from '@/shared/types';
import GitAuthenticationCard from '@/modules/project-creation-wizard/GitAuthenticationCard';
import WorkspacePathField from '@/modules/project-creation-wizard/WorkspacePathField';

type StepConfigurationProps = {
  workspacePath: string;
  githubUrl: string;
  gitProvider: GitProvider;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GitTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  isCreating: boolean;
  onWorkspacePathChange: (workspacePath: string) => void;
  onGithubUrlChange: (githubUrl: string) => void;
  onGitProviderChange: (gitProvider: GitProvider) => void;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
  onAdvanceToConfirm: () => void;
};

const PROVIDER_OPTIONS: { value: GitProvider; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'bitbucket', label: 'Bitbucket' },
  { value: 'custom', label: 'Custom Git' },
];

const URL_PLACEHOLDER: Record<GitProvider, string> = {
  github: 'https://github.com/username/repository',
  gitlab: 'https://gitlab.com/username/repository',
  bitbucket: 'https://bitbucket.org/username/repository',
  custom: 'https://git.example.com/owner/repository',
};

/** Rendered by ProjectCreationWizard as step 1, collecting the workspace path, clone URL and git authentication. */
export default function StepConfiguration({
  workspacePath,
  githubUrl,
  gitProvider,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  isCreating,
  onWorkspacePathChange,
  onGithubUrlChange,
  onGitProviderChange,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
  onAdvanceToConfirm,
}: StepConfigurationProps) {
  const { t } = useTranslation();
  const showGithubAuth = shouldShowGithubAuthentication(githubUrl);

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
          {t('projectWizard.step2.gitProvider')}
        </label>
        <select
          value={gitProvider}
          onChange={(event) => onGitProviderChange(event.target.value as GitProvider)}
          disabled={isCreating}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('projectWizard.step2.githubUrl')}
        </label>
        <Input
          type="text"
          value={githubUrl}
          onChange={(event) => onGithubUrlChange(event.target.value)}
          placeholder={URL_PLACEHOLDER[gitProvider]}
          className="w-full"
          disabled={isCreating}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('projectWizard.step2.githubHelp')}
        </p>
      </div>

      {showGithubAuth && (
        <GitAuthenticationCard
          provider={gitProvider}
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
