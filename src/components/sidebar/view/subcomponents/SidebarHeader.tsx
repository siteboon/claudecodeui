import { FolderPlus, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { IS_PLATFORM } from '../../../../constants/config';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const LogoBlock = () => (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-7 h-7 bg-primary/90 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">{t('app.title')}</h1>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden md:block px-3 pt-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '44px' } : {}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search bar */}
        {projectsCount > 0 && !isLoading && (
          <div className="relative mt-2.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <Input
              type="text"
              placeholder={t('projects.searchPlaceholder')}
              value={searchFilter}
              onChange={(event) => onSearchFilterChange(event.target.value)}
              className="nav-search-input pl-9 pr-8 h-9 text-xs rounded-xl border-0 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200"
            />
            {searchFilter && (
              <button
                onClick={onClearSearchFilter}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-accent rounded-md"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="hidden md:block nav-divider" />

      {/* Mobile header */}
      <div
        className="md:hidden p-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex items-center gap-2.5 active:opacity-70 transition-opacity min-w-0"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex gap-1.5 flex-shrink-0">
            <button
              className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center active:scale-95 transition-all"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="w-8 h-8 rounded-lg bg-primary/90 text-primary-foreground flex items-center justify-center active:scale-95 transition-all"
              onClick={onCreateProject}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {projectsCount > 0 && !isLoading && (
          <div className="relative mt-2.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50 pointer-events-none" />
            <Input
              type="text"
              placeholder={t('projects.searchPlaceholder')}
              value={searchFilter}
              onChange={(event) => onSearchFilterChange(event.target.value)}
              className="nav-search-input pl-10 pr-9 h-10 text-sm rounded-xl border-0 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200"
            />
            {searchFilter && (
              <button
                onClick={onClearSearchFilter}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded-md"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="md:hidden nav-divider" />
    </div>
  );
}
