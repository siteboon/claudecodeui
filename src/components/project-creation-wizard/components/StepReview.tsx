import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isSshGitUrl } from '../utils/pathUtils';
import type { WizardFormState } from '../types';

type StepReviewProps = {
  formState: WizardFormState;
  selectedTokenName: string | null;
  isCreating: boolean;
  cloneProgress: string;
};

export default function StepReview({
  formState,
  selectedTokenName,
  isCreating,
  cloneProgress,
}: StepReviewProps) {
  const { t } = useTranslation();

  const authenticationLabel = useMemo(() => {
    if (formState.tokenMode === 'stored' && formState.selectedGithubToken) {
      return `${t('projectWizard.step3.usingStoredToken')} ${selectedTokenName || 'Unknown'}`;
    }

    if (formState.tokenMode === 'new' && formState.newGithubToken.trim()) {
      return t('projectWizard.step3.usingProvidedToken');
    }

    if (isSshGitUrl(formState.githubUrl)) {
      return t('projectWizard.step3.sshKey', { defaultValue: 'SSH Key' });
    }

    return t('projectWizard.step3.noAuthentication');
  }, [formState, selectedTokenName, t]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
        <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
          {t('projectWizard.step3.reviewConfig')}
        </h4>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {t('projectWizard.step3.workspaceType')}
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formState.workspaceType === 'existing'
                ? t('projectWizard.step3.existingWorkspace')
                : t('projectWizard.step3.newWorkspace')}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.path')}</span>
            <span className="break-all font-mono text-xs text-gray-900 dark:text-white">
              {formState.workspacePath}
            </span>
          </div>

          {formState.workspaceType === 'new' && formState.githubUrl && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {t('projectWizard.step3.cloneFrom')}
                </span>
                <span className="break-all font-mono text-xs text-gray-900 dark:text-white">
                  {formState.githubUrl}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {t('projectWizard.step3.authentication')}
                </span>
                <span className="text-xs text-gray-900 dark:text-white">{authenticationLabel}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
        {isCreating && cloneProgress ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {t('projectWizard.step3.cloningRepository', { defaultValue: 'Cloning repository...' })}
            </p>
            <code className="block whitespace-pre-wrap break-all font-mono text-xs text-blue-700 dark:text-blue-300">
              {cloneProgress}
            </code>
          </div>
        ) : (
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {formState.workspaceType === 'existing'
              ? t('projectWizard.step3.existingInfo')
              : formState.githubUrl
                ? t('projectWizard.step3.newWithClone')
                : t('projectWizard.step3.newEmpty')}
          </p>
        )}
      </div>
    </div>
  );
}
