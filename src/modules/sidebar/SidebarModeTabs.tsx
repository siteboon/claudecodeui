import { Fragment } from 'react';
import { Activity, Archive, Folder, MessageSquare, MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import { useTabOverflow } from '@/modules/sidebar/hooks/useTabOverflow';

type ModeTab = {
  mode: SidebarSearchMode;
  /** The dropdown always shows this; the strip shows it only when `showLabel` is set. */
  label: string;
  icon: LucideIcon;
  showLabel: boolean;
};

type SidebarModeTabsProps = {
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  runningSessionsCount: number;
  t: TFunction;
};

/**
 * Used by SidebarHeader for the section strip above the search box, in both the
 * desktop and the mobile header.
 *
 * The sidebar is resizable, so the strip cannot assume it has room for all four
 * tabs: the ones that no longer fit move into a "…" dropdown at its right edge
 * instead of spilling out over the panel.
 */
export default function SidebarModeTabs({
  searchMode,
  onSearchModeChange,
  runningSessionsCount,
  t,
}: SidebarModeTabsProps) {
  const tabs: ModeTab[] = [
    { mode: 'projects', label: t('search.modeProjects'), icon: Folder, showLabel: true },
    { mode: 'conversations', label: t('search.modeConversations'), icon: MessageSquare, showLabel: true },
    { mode: 'running', label: t('search.runningTooltip', 'Running sessions'), icon: Activity, showLabel: false },
    { mode: 'archived', label: t('search.archiveOnlyTooltip', 'Archive only'), icon: Archive, showLabel: false },
  ];

  const activeIndex = tabs.findIndex((tab) => tab.mode === searchMode);
  const { rowRef, mirrorRef, visibleIndexes } = useTabOverflow(tabs.length, activeIndex);
  const hiddenTabs = tabs.filter((_, index) => !visibleIndexes.includes(index));
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);
  const moreLabel = t('search.modeMore', 'More');

  const renderTab = (tab: ModeTab, canGrow: boolean) => {
    const isActive = tab.mode === searchMode;
    const Icon = tab.icon;

    const button = (
      <button
        onClick={() => onSearchModeChange(tab.mode)}
        aria-pressed={isActive}
        aria-label={tab.showLabel ? undefined : tab.label}
        title={tab.showLabel ? undefined : tab.label}
        className={cn(
          'flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-normal transition-all',
          tab.mode === 'archived' && 'px-2.5',
          canGrow && tab.showLabel && 'flex-1',
          isActive
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          isActive && tab.mode === 'running' && 'ring-1 ring-emerald-500/15',
        )}
      >
        {tab.mode === 'running' ? (
          <span className="relative flex h-3 w-3 items-center justify-center">
            <Activity className={cn('h-3 w-3', runningSessionsCount > 0 && 'text-emerald-500')} />
            {runningSessionsCount > 0 && (
              <span className="absolute -right-2.5 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-semibold leading-none text-white shadow-sm ring-1 ring-background">
                {runningBadgeText}
              </span>
            )}
          </span>
        ) : (
          <Icon className="h-3 w-3" />
        )}
        {tab.showLabel && <span className="truncate">{tab.label}</span>}
      </button>
    );

    // The labelled tabs say what they are; the icon-only ones need the tooltip.
    return tab.showLabel ? button : <Tooltip content={tab.label} position="top">{button}</Tooltip>;
  };

  const overflowTrigger = (
    <ActionMenu
      label={moreLabel}
      ariaLabel={moreLabel}
      icon={MoreHorizontal}
      iconOnly
      portal
      variant="ghost"
      size="sm"
      className="flex-none"
      triggerClassName="h-auto rounded-md px-2 py-1.5 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3.5"
      items={hiddenTabs.map((tab) => ({
        key: tab.mode,
        label: tab.label,
        icon: tab.icon,
        onSelect: () => onSearchModeChange(tab.mode),
      }))}
    />
  );

  return (
    <div className="rounded-lg bg-muted/50 p-0.5">
      <div ref={rowRef} className="relative flex">
        {visibleIndexes.map((index) => (
          <Fragment key={tabs[index].mode}>{renderTab(tabs[index], true)}</Fragment>
        ))}
        {hiddenTabs.length > 0 && overflowTrigger}

        {/*
          An off-layout copy of the whole strip. What to drop can only be decided
          from every tab's natural width, and a tab that has already been dropped
          is no longer in the row to measure. Clipped rather than merely hidden so
          it cannot widen an ancestor's scroll area.
        */}
        <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
          <div ref={mirrorRef} className="flex w-max">
            {tabs.map((tab) => (
              <div key={tab.mode} className="flex-none">{renderTab(tab, false)}</div>
            ))}
            <div className="flex-none">{overflowTrigger}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
