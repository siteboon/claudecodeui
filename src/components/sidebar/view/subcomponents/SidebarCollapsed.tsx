import { Settings, Sparkles, PanelLeftOpen } from 'lucide-react';
import type { TFunction } from 'i18next';

const DISCORD_INVITE_URL = 'https://discord.gg/buxwujPNRE';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

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
    <div className="h-full flex flex-col items-center py-3 gap-1 bg-background/80 backdrop-blur-sm w-12">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      <div className="nav-divider w-6 my-1" />

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      {/* Discord */}
      <a
        href={DISCORD_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors group"
        aria-label={t('actions.joinCommunity')}
        title={t('actions.joinCommunity')}
      >
        <DiscordIcon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </a>

      {/* Update indicator */}
      {updateAvailable && (
        <button
          onClick={onShowVersionModal}
          className="relative w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/80 transition-colors"
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="w-4 h-4 text-blue-500" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
        </button>
      )}
    </div>
  );
}
