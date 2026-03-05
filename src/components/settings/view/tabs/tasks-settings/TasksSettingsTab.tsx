import { useTranslation } from 'react-i18next';
import { useTasksSettings } from '../../../../../contexts/TasksSettingsContext';

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  setTasksEnabled: (enabled: boolean) => void;
  isTaskMasterInstalled: boolean | null;
  isCheckingInstallation: boolean;
};

export default function TasksSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    tasksEnabled,
    setTasksEnabled,
    isTaskMasterInstalled,
    isCheckingInstallation,
  } = useTasksSettings() as TasksSettingsContextValue;

  return (
    <div className="space-y-8">
      {isCheckingInstallation ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span className="text-sm text-muted-foreground">{t('tasks.checking')}</span>
          </div>
        </div>
      ) : (
        <>
          {!isTaskMasterInstalled && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/50">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900">
                  <svg className="h-4 w-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="mb-2 font-medium text-orange-900 dark:text-orange-100">
                    {t('tasks.notInstalled.title')}
                  </div>
                  <div className="space-y-3 text-sm text-orange-800 dark:text-orange-200">
                    <p>{t('tasks.notInstalled.description')}</p>

                    <div className="rounded-lg bg-orange-100 p-3 font-mono text-sm dark:bg-orange-900/50">
                      <code>{t('tasks.notInstalled.installCommand')}</code>
                    </div>

                    <div>
                      <a
                        href="https://github.com/eyaltoledano/claude-task-master"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
                        </svg>
                        {t('tasks.notInstalled.viewOnGitHub')}
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>

                    <div className="space-y-2">
                      <p className="font-medium">{t('tasks.notInstalled.afterInstallation')}</p>
                      <ol className="list-inside list-decimal space-y-1 text-xs">
                        <li>{t('tasks.notInstalled.steps.restart')}</li>
                        <li>{t('tasks.notInstalled.steps.autoAvailable')}</li>
                        <li>{t('tasks.notInstalled.steps.initCommand')}</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isTaskMasterInstalled && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">{t('tasks.settings.enableLabel')}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{t('tasks.settings.enableDescription')}</div>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={tasksEnabled}
                      onChange={(event) => setTasksEnabled(event.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800" />
                  </label>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
