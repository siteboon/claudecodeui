import { PanelLeftClose, Search, SquarePen, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '@/shared/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '@/shared/constants';
import { IS_PLATFORM } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const ICON_BUTTON_CLASS = 'h-8 w-8 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  showSearchTools: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  /** Starts a session in the selected project; absent when no project is selected. */
  onNewSession?: () => void;
  newSessionLabel: string;
  onCollapseSidebar: () => void;
  t: TFunction;
};

/** Module-level, not a nested render function, so the wordmark is not remounted on every SidebarHeader render. */
function LogoBlock({ t }: { t: TFunction }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-primary/90">
        <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1
        className="truncate text-sm font-semibold tracking-tight text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );
}

/** Rendered by SidebarContent at the top of the panel for the wordmark, new-session and hide actions, and the search box. */
export default function SidebarHeader({
  isPWA,
  isMobile,
  showSearchTools,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onNewSession,
  newSessionLabel,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const searchPlaceholder = searchMode === 'archived'
    ? t('search.archivedPlaceholder', 'Search archived sessions...')
    : t('search.allPlaceholder', 'Search...');

  return (
    <div
      className="flex flex-shrink-0 flex-col gap-3 px-3.5 pb-2 pt-4"
      style={isPWA && isMobile ? { paddingTop: '16px' } : undefined}
    >
      <div className="flex items-center justify-between gap-2 pl-1">
        {IS_PLATFORM ? (
          <a
            href="https://cloudcli.ai/dashboard"
            className="flex min-w-0 items-center transition-opacity hover:opacity-80"
            title={t('tooltips.viewEnvironments')}
          >
            <LogoBlock t={t} />
          </a>
        ) : (
          <LogoBlock t={t} />
        )}

        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={ICON_BUTTON_CLASS}
            onClick={onNewSession}
            disabled={!onNewSession}
            title={newSessionLabel}
            aria-label={newSessionLabel}
          >
            <SquarePen className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`${ICON_BUTTON_CLASS} hidden md:inline-flex`}
            onClick={onCollapseSidebar}
            title={t('tooltips.hideSidebar')}
            aria-label={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showSearchTools && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={searchFilter}
            onChange={(event) => onSearchFilterChange(event.target.value)}
            className="nav-search-input h-9 rounded-lg border-0 pl-9 pr-14 text-sm placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {searchFilter ? (
            <button
              onClick={onClearSearchFilter}
              aria-label={t('tooltips.clearSearch')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ) : (
            <kbd
              aria-hidden
              title={t('tooltips.openCommandPalette')}
              className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
            >
              {MOD_KEY}
              <span>K</span>
            </kbd>
          )}
        </div>
      )}
    </div>
  );
}
