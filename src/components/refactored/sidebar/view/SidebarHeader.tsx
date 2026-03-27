import { useState } from 'react';
import { FolderPlus, Plus, RefreshCw, PanelLeftClose } from 'lucide-react';
import type { SearchMode } from '../types';
import { SidebarSearch } from './SidebarSearch';
import { Button } from '@/shared/view/ui';
import { cn } from '@/lib/utils';
import { IS_PLATFORM } from '@/constants/config';

type SidebarHeaderProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

export default function SidebarHeader({ isCollapsed, onToggleCollapse }: SidebarHeaderProps) {
  // UI States declared here to avoid prop drilling as per instructions
  const [searchMode, setSearchMode] = useState<SearchMode>('projects');
  const [searchFilter, setSearchFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
        <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">Claude Code UI</h1>
    </div>
  );

  const LogoWithLink = () => {
    if (IS_PLATFORM) {
      return (
        <a
          href="https://cloudcli.ai/dashboard"
          className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80 active:opacity-70"
          title="View Environments Dashboard"
        >
          <LogoBlock />
        </a>
      );
    }
    return <LogoBlock />;
  };

  if (isCollapsed) return null;

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div className="hidden px-3 pb-2 pt-3 md:block">
        <div className="flex items-center justify-between gap-2">
          <LogoWithLink />
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              title="New Project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onToggleCollapse}
              title="Hide Sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <SidebarSearch 
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
        />
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div className="p-3 pb-2 md:hidden">
        <div className="flex items-center justify-between">
          <LogoWithLink />
          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("h-4 w-4 text-muted-foreground", isRefreshing && "animate-spin")} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <SidebarSearch 
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
        />
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
