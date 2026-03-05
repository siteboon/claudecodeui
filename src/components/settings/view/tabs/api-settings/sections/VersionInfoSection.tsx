import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReleaseInfo } from '../../../../../../types/sharedTypes';

type VersionInfoSectionProps = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseInfo: ReleaseInfo | null;
};

export default function VersionInfoSection({
  currentVersion,
  updateAvailable,
  latestVersion,
  releaseInfo,
}: VersionInfoSectionProps) {
  const { t } = useTranslation('settings');
  const releasesUrl = releaseInfo?.htmlUrl || 'https://github.com/siteboon/claudecodeui/releases';

  return (
    <div className="border-t border-border/50 pt-6">
      <div className="flex items-center justify-between text-xs italic text-muted-foreground/60">
        <a
          href={releasesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-muted-foreground"
        >
          v{currentVersion}
        </a>
        {updateAvailable && latestVersion && (
          <a
            href={releasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 font-medium not-italic text-green-600 transition-colors hover:bg-green-500/20 dark:text-green-400"
          >
            <span className="text-[10px]">{t('apiKeys.version.updateAvailable', { version: latestVersion })}</span>
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
