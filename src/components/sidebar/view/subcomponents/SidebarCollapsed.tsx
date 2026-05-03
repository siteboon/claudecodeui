import { Settings, PanelLeftOpen, Search, PenSquare, Sparkles, Bug } from 'lucide-react';
import type { TFunction } from 'i18next';

const GITHUB_ISSUES_URL = 'https://github.com/siteboon/claudecodeui/issues/new';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  updateAvailable: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  updateAvailable,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-border/50 bg-card py-3">
      {/* Brand logo / expand */}
      <button
        onClick={onExpand}
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 shadow-sm transition-colors hover:bg-primary"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* New Chat */}
      <button
        onClick={onExpand}
        className="group mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
        aria-label="New Chat"
        title="New Chat"
      >
        <PenSquare className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Search */}
      <button
        onClick={onExpand}
        className="group mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
        aria-label="Search"
        title="Search"
      >
        <Search className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Expand sidebar */}
      <button
        onClick={onExpand}
        className="group mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="flex-1" />

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-blue-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        </button>
      )}

      {/* Report Issue */}
      <a
        href={GITHUB_ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="group mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
        aria-label={t('actions.reportIssue')}
        title={t('actions.reportIssue')}
      >
        <Bug className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </a>

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--sidebar-hover))]"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </div>
  );
}
