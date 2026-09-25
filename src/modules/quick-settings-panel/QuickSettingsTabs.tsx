import type { KeyboardEvent } from 'react';
import { Settings2, Terminal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { QuickSettingsTab } from '@/shared/types';
import { getQuickSettingsTabId, getQuickSettingsTabPanelId } from '@/shared/utils';

type TabDefinition = {
  id: QuickSettingsTab;
  labelKey: string;
  icon: LucideIcon;
};

const TABS: TabDefinition[] = [
  { id: 'settings', labelKey: 'quickSettings.tabs.settings', icon: Settings2 },
  { id: 'commands', labelKey: 'quickSettings.tabs.commands', icon: Terminal },
];

type QuickSettingsTabsProps = {
  activeTab: QuickSettingsTab;
  onSelectTab: (tab: QuickSettingsTab) => void;
};

/** Rendered by QuickSettingsPanelView under the header to switch between the Settings and Commands areas. */
export default function QuickSettingsTabs({ activeTab, onSelectTab }: QuickSettingsTabsProps) {
  const { t } = useTranslation('settings');

  // Arrow keys move between tabs as a tablist expects; the active tab is the
  // only one in the tab order, so focus follows the selection.
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else return;

    event.preventDefault();
    const nextTab = TABS[nextIndex].id;
    onSelectTab(nextTab);
    document.getElementById(getQuickSettingsTabId(nextTab))?.focus();
  };

  return (
    <div role="tablist" aria-label={t('quickSettings.title')} className="flex border-b border-border">
      {TABS.map(({ id, labelKey, icon: Icon }) => {
        const isActive = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={getQuickSettingsTabId(id)}
            aria-selected={isActive}
            // Only the active tab's panel is in the DOM.
            aria-controls={isActive ? getQuickSettingsTabPanelId(id) : undefined}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelectTab(id)}
            onKeyDown={handleKeyDown}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
