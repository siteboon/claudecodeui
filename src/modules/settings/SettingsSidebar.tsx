import { Bell, Bot, GitBranch, Info, Key, ListChecks, MessageSquare, Mic, MonitorPlay, Palette, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { PillBar, Pill } from '@/shared/ui';
import type { SettingsMainTab } from '@/shared/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  fallback: string;
  icon: typeof Bot;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', fallback: 'Agents', icon: Bot },
  { id: 'sessions', labelKey: 'mainTabs.sessions', fallback: 'Sessions', icon: MessageSquare },
  { id: 'appearance', labelKey: 'mainTabs.appearance', fallback: 'Appearance', icon: Palette },
  { id: 'git', labelKey: 'mainTabs.git', fallback: 'Git', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', fallback: 'API & Tokens', icon: Key },
  { id: 'voice', labelKey: 'mainTabs.voice', fallback: 'Voice', icon: Mic },
  { id: 'tasks', labelKey: 'mainTabs.tasks', fallback: 'Tasks', icon: ListChecks },
  { id: 'browser', labelKey: 'mainTabs.browser', fallback: 'Browser', icon: MonitorPlay },
  { id: 'plugins', labelKey: 'mainTabs.plugins', fallback: 'Plugins', icon: Puzzle },
  { id: 'notifications', labelKey: 'mainTabs.notifications', fallback: 'Notifications', icon: Bell },
  { id: 'about', labelKey: 'mainTabs.about', fallback: 'About', icon: Info },
];

/** Rendered by Settings to switch between the settings dialog's main sections. */
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
                {t(item.labelKey, item.fallback)}
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
                {t(item.labelKey, item.fallback)}
              </Pill>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
