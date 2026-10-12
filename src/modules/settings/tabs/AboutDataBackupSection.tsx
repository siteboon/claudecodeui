import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy, Database, Download, ExternalLink, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDataBackup } from '@/modules/settings/hooks/useDataBackup';
import { Button } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

const BACKUP_GUIDE_URL = 'https://github.com/siteboon/claudecodeui#back-up-and-restore-your-data';
const COPIED_FEEDBACK_MS = 2000;

type StoragePathRowProps = {
  icon: ReactNode;
  label: string;
  path: string | null;
  placeholder: string;
};

function StoragePathRow({ icon, label, path, placeholder }: StoragePathRowProps) {
  const { t } = useTranslation('settings');
  // Confirms a successful copy next to the path for a moment.
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const copyPath = async () => {
    if (!path || !(await copyTextToClipboard(path))) {
      return;
    }
    setIsCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setIsCopied(false);
      resetTimerRef.current = null;
    }, COPIED_FEEDBACK_MS);
  };

  const copyLabel = isCopied ? t('about.dataBackup.pathCopied') : t('about.dataBackup.copyPath');

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {/* Paths are long and unbreakable; break anywhere so narrow screens never scroll sideways.
            dir="ltr" keeps the separators in order in right-to-left locales. */}
        <code dir="ltr" className="mt-0.5 block select-all break-all font-mono text-xs text-muted-foreground">
          {path ?? placeholder}
        </code>
      </div>
      {path && (
        <button
          type="button"
          onClick={() => void copyPath()}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={copyLabel}
          aria-label={`${copyLabel}: ${label}`}
        >
          {isCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

/**
 * Rendered by the About tab on self-hosted installs: shows where the database
 * and uploaded files live and downloads a consistent database backup.
 */
export default function AboutDataBackupSection() {
  const { t } = useTranslation('settings');
  const { locations, hasLocationsError, isDownloading, hasDownloadError, downloadBackup } = useDataBackup();

  return (
    <div className="space-y-4 border-t border-border/50 pt-6" data-testid="about-storage-section">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t('about.dataBackup.title')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('about.dataBackup.description')}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        {hasLocationsError ? (
          <p className="text-xs text-muted-foreground">{t('about.dataBackup.loadFailed')}</p>
        ) : (
          <>
            <StoragePathRow
              icon={<Database className="h-3.5 w-3.5" />}
              label={t('about.dataBackup.databaseLabel')}
              path={locations?.databasePath ?? null}
              placeholder={t('about.dataBackup.loading')}
            />
            <StoragePathRow
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t('about.dataBackup.assetsLabel')}
              path={locations?.assetsPath ?? null}
              placeholder={t('about.dataBackup.loading')}
            />
          </>
        )}
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void downloadBackup()}
          disabled={isDownloading}
        >
          {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
          {isDownloading ? t('about.dataBackup.downloading') : t('about.dataBackup.download')}
        </Button>
        {hasDownloadError && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {t('about.dataBackup.downloadFailed')}
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('about.dataBackup.backupNote')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('about.dataBackup.restoreNote')}</p>
        <a
          href={BACKUP_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
        >
          {t('about.dataBackup.restoreGuide')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
