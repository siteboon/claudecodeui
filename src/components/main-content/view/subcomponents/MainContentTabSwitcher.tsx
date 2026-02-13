import Tooltip from '../../../Tooltip';
import type { AppTab } from '../../../../types/app';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  iconPath: string;
};

const BASE_TABS: TabDefinition[] = [
  {
    id: 'chat',
    labelKey: 'tabs.chat',
    iconPath:
      'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    id: 'shell',
    labelKey: 'tabs.shell',
    iconPath: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
  {
    id: 'files',
    labelKey: 'tabs.files',
    iconPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z',
  },
  {
    id: 'git',
    labelKey: 'tabs.git',
    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
];

const TASKS_TAB: TabDefinition = {
  id: 'tasks',
  labelKey: 'tabs.tasks',
  iconPath:
    'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};

function getButtonClasses(tabId: AppTab, activeTab: AppTab) {
  const base = 'relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200';

  if (tabId === activeTab) {
    return `${base} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
  }

  return `${base} text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700`;
}

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = shouldShowTasksTab ? [...BASE_TABS, TASKS_TAB] : BASE_TABS;

  return (
    <div className="relative flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      {tabs.map((tab) => (
        <Tooltip key={tab.id} content={t(tab.labelKey)} position="bottom">
          <button onClick={() => setActiveTab(tab.id)} className={getButtonClasses(tab.id, activeTab)}>
            <span className="flex items-center gap-1 sm:gap-1.5">
              <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.iconPath} />
              </svg>
              <span className="hidden md:hidden lg:inline">{t(tab.labelKey)}</span>
            </span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
