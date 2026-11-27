import { Settings, Sparkles, PanelLeftOpen, SquarePen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarCollapsedProps = {
  onExpand: () => void;
  /** Starts a session in the selected project; absent when no project is selected. */
  onNewSession?: () => void;
  newSessionLabel: string;
  onShowSettings: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

/** Rendered by Sidebar instead of SidebarContent when the panel is collapsed to its icon rail: expand and new session, with settings and version status at the bottom. */
export default function SidebarCollapsed({
  onExpand,
  onNewSession,
  newSessionLabel,
  onShowSettings,
  updateAvailable,
  restartRequired,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background py-3">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <button
        onClick={onNewSession}
        disabled={!onNewSession}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80 disabled:opacity-40"
        aria-label={newSessionLabel}
        title={newSessionLabel}
      >
        <SquarePen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
        </div>
      )}

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-blue-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        </button>
      )}
    </div>
  );
}
