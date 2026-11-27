import { AlertTriangle, Archive, Bug, MessageCircle, MoreHorizontal, RefreshCw, Settings, Star } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu } from '@/shared/ui';
import { IS_PLATFORM, cn } from '@/shared/utils';
import type { ReleaseInfo } from '@/shared/types';
import { useGitHubStars } from '@/modules/sidebar/hooks/useGitHubStars';

const GITHUB_ISSUES_URL = 'https://github.com/siteboon/claudecodeui/issues/new';
const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';
const DISCORD_INVITE_URL = 'https://discord.gg/buxwujPNRE';

const FOOTER_BUTTON_CLASS =
  'flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground';

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowArchive: () => void;
  onRefresh: () => void;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

/** Rendered by SidebarContent at the bottom of the panel: settings, update, and a menu for archive and the rarely used links. */
export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowArchive,
  onRefresh,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const { formattedCount } = useGitHubStars('siteboon', 'claudecodeui');

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* The running server version differs from the installed one (updated but not restarted). */}
      {restartRequired && (
        <p className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          {t('version.restartRequired')}
        </p>
      )}

      <div className="flex h-14 items-center gap-1 border-t border-border/50 px-3">
        <button type="button" className={FOOTER_BUTTON_CLASS} onClick={onShowSettings}>
          <Settings className="h-4 w-4" />
          {t('actions.settings')}
        </button>

        <div className="flex-1" />

        {updateAvailable && (
          <button
            type="button"
            className={cn(FOOTER_BUTTON_CLASS, 'text-blue-600 dark:text-blue-300')}
            onClick={onShowVersionModal}
            title={`${t('version.updateAvailable')}: ${releaseInfo?.title || `v${latestVersion}`}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
            {t('version.update', 'Update')}
          </button>
        )}

        <ActionMenu
          label={t('search.modeMore', 'More')}
          ariaLabel={t('search.modeMore', 'More')}
          icon={MoreHorizontal}
          iconOnly
          portal
          variant="ghost"
          size="icon"
          triggerClassName="h-8 w-8 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          header={(
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              CloudCLI v{currentVersion}
              {!IS_PLATFORM && ` – ${t('branding.openSource')}`}
            </p>
          )}
          items={[
            { key: 'refresh', label: t('actions.refresh'), icon: RefreshCw, onSelect: onRefresh },
            { key: 'archive', label: t('search.archiveOnlyTooltip', 'Archive'), icon: Archive, onSelect: onShowArchive },
            { key: 'issue', label: t('actions.reportIssue'), icon: Bug, showDividerBefore: true, onSelect: () => openExternal(GITHUB_ISSUES_URL) },
            { key: 'discord', label: t('actions.joinCommunity'), icon: MessageCircle, onSelect: () => openExternal(DISCORD_INVITE_URL) },
            ...(IS_PLATFORM ? [] : [{
              key: 'github',
              label: formattedCount ? `${t('actions.starOnGithub')} (${formattedCount})` : t('actions.starOnGithub'),
              icon: Star,
              onSelect: () => openExternal(GITHUB_REPO_URL),
            }]),
          ]}
        />
      </div>
    </div>
  );
}
