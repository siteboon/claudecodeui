import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Terminal, Folder, GitBranch, ClipboardCheck, Kanban, MoreHorizontal, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import PluginIcon from '../../../plugins/view/PluginIcon';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
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

const PRIMARY_IDS: AppTab[] = ['chat', 'shell'];

const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
  { kind: 'builtin', id: 'board', labelKey: 'tabs.board', icon: Kanban },
];

const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleMoreClick = () => {
    if (menuOpen) {
      setMenuOpen(false);
      setDropdownPos(null);
      return;
    }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setMenuOpen(true);
  };

  const builtInTabs: BuiltInTab[] = shouldShowTasksTab ? [...BASE_TABS, TASKS_TAB] : BASE_TABS;

  const pluginTabs: PluginTab[] = plugins
    .filter((p) => p.enabled)
    .map((p) => ({
      kind: 'plugin',
      id: `plugin:${p.name}` as AppTab,
      label: p.displayName,
      pluginName: p.name,
      iconFile: p.icon,
    }));

  const allTabs: TabDefinition[] = [...builtInTabs, ...pluginTabs];
  const primaryTabs = allTabs.filter((t) => PRIMARY_IDS.includes(t.id));
  const secondaryTabs = allTabs.filter((t) => !PRIMARY_IDS.includes(t.id));
  const activeSecondary = secondaryTabs.find((t) => t.id === activeTab);

  return (
    <PillBar>
      {primaryTabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;
        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill isActive={isActive} onClick={() => setActiveTab(tab.id)} className="px-2.5 py-[5px]">
              {tab.kind === 'builtin' ? (
                <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              ) : (
                <PluginIcon
                  pluginName={(tab as PluginTab).pluginName}
                  iconFile={(tab as PluginTab).iconFile}
                  className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                />
              )}
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}

      {secondaryTabs.length > 0 && (
        <div ref={buttonRef}>
          <Tooltip content={activeSecondary ? (activeSecondary.kind === 'builtin' ? t(activeSecondary.labelKey) : activeSecondary.label) : 'More'} position="bottom">
            <Pill isActive={!!activeSecondary} onClick={handleMoreClick} className="px-2.5 py-[5px]">
              {activeSecondary ? (
                activeSecondary.kind === 'builtin' ? (
                  <activeSecondary.icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                ) : (
                  <PluginIcon
                    pluginName={activeSecondary.pluginName}
                    iconFile={activeSecondary.iconFile}
                    className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  />
                )
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              {activeSecondary && (
                <span className="hidden lg:inline">
                  {activeSecondary.kind === 'builtin' ? t(activeSecondary.labelKey) : activeSecondary.label}
                </span>
              )}
            </Pill>
          </Tooltip>
        </div>
      )}
      {menuOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999 }}
          className="min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {secondaryTabs.map((tab) => {
            const label = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id); setMenuOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-muted ${isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {tab.kind === 'builtin' ? (
                  <tab.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                ) : (
                  <PluginIcon
                    pluginName={(tab as PluginTab).pluginName}
                    iconFile={(tab as PluginTab).iconFile}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  />
                )}
                {label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </PillBar>
  );
}
