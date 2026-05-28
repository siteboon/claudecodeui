import { Bell, Bot, GitBranch, Info, Key, ListChecks, Palette, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { PillBar, Pill } from '../../../shared/view/ui';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof Bot;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', icon: Bot },
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', icon: Key },
  { id: 'tasks', labelKey: 'mainTabs.tasks', icon: ListChecks },
  { id: 'plugins', labelKey: 'mainTabs.plugins', icon: Puzzle },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile horizontal nav — pill bar */}
      <div className="flex-shrink-0 border-b border-border px-3 py-2 md:hidden">
        <PillBar className="scrollbar-hide w-full overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <Pill
                key={item.id}
                isActive={activeTab === item.id}
                onClick={() => onChange(item.id)}
                className="flex-shrink-0"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </Pill>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
