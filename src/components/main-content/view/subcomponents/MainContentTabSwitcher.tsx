import { MessageSquare, Terminal, Folder, GitBranch, ClipboardCheck, CircleDot, type LucideIcon } from 'lucide-react';
import Tooltip from '../../../Tooltip';
import type { AppTab } from '../../../../types/app';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBeadsTab?: boolean;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

const BASE_TABS: TabDefinition[] = [
  { id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
  { id: 'git', labelKey: 'tabs.git', icon: GitBranch },
];

const TASKS_TAB: TabDefinition = {
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

const BEADS_TAB: TabDefinition = {
  id: 'beads',
  labelKey: 'tabs.beads',
  icon: CircleDot,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBeadsTab = false,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  let tabs = [...BASE_TABS];
  if (shouldShowTasksTab) {
    tabs.push(TASKS_TAB);
  }
  if (shouldShowBeadsTab) {
    tabs.push(BEADS_TAB);
  }

  return (
    <div className="inline-flex items-center bg-muted/60 rounded-lg p-[3px] gap-[2px]">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;

        return (
          <Tooltip key={tab.id} content={t(tab.labelKey)} position="bottom">
            <button
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-2.5 py-[5px] text-sm font-medium rounded-md transition-all duration-150 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="hidden lg:inline">{t(tab.labelKey)}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
