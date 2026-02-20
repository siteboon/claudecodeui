import { GitBranch, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SettingsMainTab } from '../types/types';

type SettingsMainTabsProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type MainTabConfig = {
  id: SettingsMainTab;
  labelKey: string;
  icon?: typeof GitBranch;
};

const TAB_CONFIG: MainTabConfig[] = [
  { id: 'agents', labelKey: 'mainTabs.agents' },
  { id: 'appearance', labelKey: 'mainTabs.appearance' },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', icon: Key },
  { id: 'tasks', labelKey: 'mainTabs.tasks' },
];

export default function SettingsMainTabs({ activeTab, onChange }: SettingsMainTabsProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-border">
      <div className="flex px-4 md:px-6">
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {Icon && <Icon className="w-4 h-4 inline mr-2" />}
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
