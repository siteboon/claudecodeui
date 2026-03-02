import { FileText, Settings, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { PrdFile } from '../types';

type TaskEmptyStateProps = {
  className?: string;
  hasTaskMasterDirectory: boolean;
  existingPrds: PrdFile[];
  onOpenSetupModal: () => void;
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
};

export default function TaskEmptyState({
  className = '',
  hasTaskMasterDirectory,
  existingPrds,
  onOpenSetupModal,
  onCreatePrd,
  onOpenPrd,
}: TaskEmptyStateProps) {
  const { t } = useTranslation('tasks');

  if (!hasTaskMasterDirectory) {
    return (
      <div className={cn('text-center py-12', className)}>
        <div className="max-w-md mx-auto">
          <div className="text-blue-600 dark:text-blue-400 mb-4">
            <Settings className="w-12 h-12 mx-auto mb-4" />
          </div>

          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{t('notConfigured.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{t('notConfigured.description')}</p>

          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg text-left">
            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-3">{t('notConfigured.whatIsTitle')}</h4>
            <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <p>- {t('notConfigured.features.aiPowered')}</p>
              <p>- {t('notConfigured.features.prdTemplates')}</p>
              <p>- {t('notConfigured.features.dependencyTracking')}</p>
              <p>- {t('notConfigured.features.progressVisualization')}</p>
              <p>- {t('notConfigured.features.cliIntegration')}</p>
            </div>
          </div>

          <button
            onClick={onOpenSetupModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <Terminal className="w-4 h-4" />
            {t('notConfigured.initializeButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('text-center py-12', className)}>
      <div className="max-w-4xl mx-auto">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 rounded-xl border border-blue-200 dark:border-blue-800 p-6 mb-6 text-left">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('gettingStarted.title')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('gettingStarted.subtitle')}</p>
            </div>
          </div>

          <div className="space-y-3 mb-4">
            <div className="p-3 bg-white dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-800/50">
              <h4 className="font-medium text-gray-900 dark:text-white mb-1">1. {t('gettingStarted.steps.createPRD.title')}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('gettingStarted.steps.createPRD.description')}</p>

              <button
                onClick={onCreatePrd}
                className="inline-flex items-center gap-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50"
              >
                <FileText className="w-3 h-3" />
                {t('gettingStarted.steps.createPRD.addButton')}
              </button>

              {existingPrds.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('gettingStarted.steps.createPRD.existingPRDs')}</p>
                  <div className="flex flex-wrap gap-2">
                    {existingPrds.map((prd) => (
                      <button
                        key={prd.name}
                        onClick={() => onOpenPrd(prd)}
                        className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        <FileText className="w-3 h-3" />
                        {prd.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-white dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-800/50">
              <h4 className="font-medium text-gray-900 dark:text-white mb-1">2. {t('gettingStarted.steps.generateTasks.title')}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('gettingStarted.steps.generateTasks.description')}</p>
            </div>

            <div className="p-3 bg-white dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-800/50">
              <h4 className="font-medium text-gray-900 dark:text-white mb-1">3. {t('gettingStarted.steps.analyzeTasks.title')}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('gettingStarted.steps.analyzeTasks.description')}</p>
            </div>

            <div className="p-3 bg-white dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-800/50">
              <h4 className="font-medium text-gray-900 dark:text-white mb-1">4. {t('gettingStarted.steps.startBuilding.title')}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('gettingStarted.steps.startBuilding.description')}</p>
            </div>
          </div>

          <button
            onClick={onCreatePrd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium"
          >
            <FileText className="w-4 h-4" />
            {t('buttons.addPRD')}
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">{t('gettingStarted.tip')}</p>
      </div>
    </div>
  );
}
