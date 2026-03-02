import { Key, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../shared/view/ui';
import type { GithubTokenCredential, TokenMode } from '../types';

type GithubAuthenticationCardProps = {
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  availableTokens: GithubTokenCredential[];
  loadingTokens: boolean;
  tokenLoadError: string | null;
  onTokenModeChange: (tokenMode: TokenMode) => void;
  onSelectedGithubTokenChange: (tokenId: string) => void;
  onNewGithubTokenChange: (tokenValue: string) => void;
};

const getModeClassName = (mode: TokenMode, selectedMode: TokenMode) =>
  `px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
    mode === selectedMode
      ? mode === 'none'
        ? 'bg-green-500 text-white'
        : 'bg-blue-500 text-white'
      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }`;

export default function GithubAuthenticationCard({
  tokenMode,
  selectedGithubToken,
  newGithubToken,
  availableTokens,
  loadingTokens,
  tokenLoadError,
  onTokenModeChange,
  onSelectedGithubTokenChange,
  onNewGithubTokenChange,
}: GithubAuthenticationCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-start gap-3 mb-4">
        <Key className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h5 className="font-medium text-gray-900 dark:text-white mb-1">
            {t('projectWizard.step2.githubAuth')}
          </h5>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('projectWizard.step2.githubAuthHelp')}
          </p>
        </div>
      </div>

      {loadingTokens && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('projectWizard.step2.loadingTokens')}
        </div>
      )}

      {!loadingTokens && tokenLoadError && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{tokenLoadError}</p>
      )}

      {!loadingTokens && availableTokens.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button
              onClick={() => onTokenModeChange('stored')}
              className={getModeClassName(tokenMode, 'stored')}
            >
              {t('projectWizard.step2.storedToken')}
            </button>
            <button
              onClick={() => onTokenModeChange('new')}
              className={getModeClassName(tokenMode, 'new')}
            >
              {t('projectWizard.step2.newToken')}
            </button>
            <button
              onClick={() => {
                onTokenModeChange('none');
                onSelectedGithubTokenChange('');
                onNewGithubTokenChange('');
              }}
              className={getModeClassName(tokenMode, 'none')}
            >
              {t('projectWizard.step2.nonePublic')}
            </button>
          </div>

          {tokenMode === 'stored' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projectWizard.step2.selectToken')}
              </label>
              <select
                value={selectedGithubToken}
                onChange={(event) => onSelectedGithubTokenChange(event.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
              >
                <option value="">{t('projectWizard.step2.selectTokenPlaceholder')}</option>
                {availableTokens.map((token) => (
                  <option key={token.id} value={String(token.id)}>
                    {token.credential_name}
                  </option>
                ))}
              </select>
            </div>
          ) : tokenMode === 'new' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projectWizard.step2.newToken')}
              </label>
              <Input
                type="password"
                value={newGithubToken}
                onChange={(event) => onNewGithubTokenChange(event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('projectWizard.step2.tokenHelp')}
              </p>
            </div>
          ) : null}
        </>
      )}

      {!loadingTokens && availableTokens.length === 0 && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {t('projectWizard.step2.publicRepoInfo')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('projectWizard.step2.optionalTokenPublic')}
            </label>
            <Input
              type="password"
              value={newGithubToken}
              onChange={(event) => {
                const tokenValue = event.target.value;
                onNewGithubTokenChange(tokenValue);
                onTokenModeChange(tokenValue.trim() ? 'new' : 'none');
              }}
              placeholder={t('projectWizard.step2.tokenPublicPlaceholder')}
              className="w-full"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('projectWizard.step2.noTokensHelp')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
