import { Settings, Sparkles } from 'lucide-react';
import type { TFunction } from 'i18next';

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
    <div className="h-full flex flex-col items-center py-4 gap-4 bg-card">
      <button
        onClick={onExpand}
        className="p-2 hover:bg-accent rounded-md transition-colors duration-200 group"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <svg
          className="w-5 h-5 text-foreground group-hover:scale-110 transition-transform"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>

      <button
        onClick={onShowSettings}
        className="p-2 hover:bg-accent rounded-md transition-colors duration-200"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
      </button>

      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative p-2 hover:bg-accent rounded-md transition-colors duration-200"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="w-5 h-5 text-blue-500" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
        </button>
      )}
    </div>
  );
}
