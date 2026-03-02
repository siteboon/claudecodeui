import { useState } from 'react';
import { Plus, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import Shell from '../../../shell/view/Shell';
import type { TaskMasterProject } from '../../types';

type TaskMasterSetupModalProps = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
};

export default function TaskMasterSetupModal({ isOpen, project, onClose, onAfterClose = null }: TaskMasterSetupModalProps) {
  const { t } = useTranslation('tasks');
  const [isTaskMasterComplete, setIsTaskMasterComplete] = useState(false);

  if (!isOpen || !project) {
    return null;
  }

  const closeModal = () => {
    onClose();
    setIsTaskMasterComplete(false);

    // Delay refresh slightly so the CLI has time to flush writes to disk.
    window.setTimeout(() => {
      onAfterClose?.();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl h-[600px] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('setupModal.title')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('setupModal.subtitle', { projectName: project.displayName })}</p>
            </div>
          </div>

          <button
            onClick={closeModal}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Close"
          >
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="flex-1 p-4">
          <div className="h-full bg-black rounded-lg overflow-hidden">
            <Shell
              selectedProject={project}
              selectedSession={null}
              initialCommand="npx task-master init"
              isPlainShell
              isActive
              onProcessComplete={(exitCode) => {
                if (exitCode === 0) {
                  setIsTaskMasterComplete(true);
                }
              }}
            />
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {isTaskMasterComplete ? (
                <span className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  {t('setupModal.completed')}
                </span>
              ) : (
                t('setupModal.willStart')
              )}
            </div>

            <button
              onClick={closeModal}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                isTaskMasterComplete
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600',
              )}
            >
              {isTaskMasterComplete ? t('setupModal.closeContinueButton') : t('setupModal.closeButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
