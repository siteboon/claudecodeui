import { FolderPlus, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceType } from '../types';

type StepTypeSelectionProps = {
  workspaceType: WorkspaceType;
  onWorkspaceTypeChange: (workspaceType: WorkspaceType) => void;
};

export default function StepTypeSelection({
  workspaceType,
  onWorkspaceTypeChange,
}: StepTypeSelectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
        {t('projectWizard.step1.question')}
      </h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => onWorkspaceTypeChange('existing')}
          className={`p-4 border-2 rounded-lg text-left transition-all ${
            workspaceType === 'existing'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
              <FolderPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                {t('projectWizard.step1.existing.title')}
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('projectWizard.step1.existing.description')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => onWorkspaceTypeChange('new')}
          className={`p-4 border-2 rounded-lg text-left transition-all ${
            workspaceType === 'new'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
              <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                {t('projectWizard.step1.new.title')}
              </h5>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('projectWizard.step1.new.description')}
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
