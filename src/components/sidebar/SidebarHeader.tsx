import { FolderPlus, MessageSquare, RefreshCw, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { IS_PLATFORM } from '../../constants/config';

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
  return (
    <>
      <div
        className="md:p-4 md:border-b md:border-border"
        style={isPWA && isMobile ? { paddingTop: '44px' } : {}}
      >
        <div className="hidden md:flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex items-center gap-3 hover:opacity-80 transition-opacity group"
              title={t('tooltips.viewEnvironments')}
            >
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                <MessageSquare className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">{t('app.title')}</h1>
                <p className="text-sm text-muted-foreground">{t('app.subtitle')}</p>
              </div>
            </a>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <MessageSquare className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">{t('app.title')}</h1>
                <p className="text-sm text-muted-foreground">{t('app.subtitle')}</p>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0 hover:bg-accent transition-colors duration-200"
            onClick={onCollapseSidebar}
            title={t('tooltips.hideSidebar')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
        </div>

        <div
          className="md:hidden p-3 border-b border-border"
          style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
        >
          <div className="flex items-center justify-between">
            {IS_PLATFORM ? (
              <a
                href="https://cloudcli.ai/dashboard"
                className="flex items-center gap-3 active:opacity-70 transition-opacity"
                title={t('tooltips.viewEnvironments')}
              >
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{t('app.title')}</h1>
                  <p className="text-sm text-muted-foreground">{t('projects.title')}</p>
                </div>
              </a>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{t('app.title')}</h1>
                  <p className="text-sm text-muted-foreground">{t('projects.title')}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center active:scale-95 transition-all duration-150"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 text-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-all duration-150"
                onClick={onCreateProject}
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {!isLoading && !isMobile && (
        <div className="px-3 md:px-4 py-2 border-b border-border">
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1 h-8 text-xs bg-primary hover:bg-primary/90 transition-all duration-200"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
              {t('projects.newProject')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 px-0 hover:bg-accent transition-colors duration-200 group"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-300'
                }`}
              />
            </Button>
          </div>
        </div>
      )}

      {projectsCount > 0 && !isLoading && (
        <div className="px-3 md:px-4 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('projects.searchPlaceholder')}
              value={searchFilter}
              onChange={(event) => onSearchFilterChange(event.target.value)}
              className="pl-9 h-9 text-sm bg-muted/50 border-0 focus:bg-background focus:ring-1 focus:ring-primary/20"
            />
            {searchFilter && (
              <button
                onClick={onClearSearchFilter}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-accent rounded"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
