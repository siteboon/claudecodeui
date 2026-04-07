import { ClipboardCheck, Folder, GitBranch, MessageSquare, Terminal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlugins } from '@/contexts/PluginsContext';
import { useTasksSettings } from '@/contexts/TasksSettingsContext';
import { Pill, PillBar, Tooltip } from '@/shared/view/ui';
import type { AppTab } from '@/types/app';
import PluginIcon from '@/components/plugins/view/PluginIcon';

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

type PluginTab = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

type TabDefinition = BuiltInTab | PluginTab;

type MainHeadingTabSwitcherProps = {
  activeTab: AppTab;
  onTabSelect: (tabId: AppTab) => void;
};

const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'git', labelKey: 'tabs.git', icon: GitBranch },
];

const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

export function MainHeadingTabSwitcher({ activeTab, onTabSelect }: MainHeadingTabSwitcherProps) {
  const { t } = useTranslation('common');
  const { plugins } = usePlugins();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;
  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);

  const builtInTabs: BuiltInTab[] = shouldShowTasksTab ? [...BASE_TABS, TASKS_TAB] : BASE_TABS;
  const pluginTabs: PluginTab[] = plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin) => ({
      kind: 'plugin',
      id: `plugin:${plugin.name}` as AppTab,
      label: plugin.displayName,
      pluginName: plugin.name,
      iconFile: plugin.icon,
    }));

  const tabs: TabDefinition[] = [...builtInTabs, ...pluginTabs];

  return (
    <PillBar>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => onTabSelect(tab.id)}
              className="px-2.5 py-[5px]"
            >
              {tab.kind === 'builtin' ? (
                <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              ) : (
                <PluginIcon
                  pluginName={tab.pluginName}
                  iconFile={tab.iconFile}
                  className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                />
              )}
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}
