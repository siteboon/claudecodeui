import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type VersionInfoSectionProps = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
};

export default function VersionInfoSection({
  currentVersion,
  updateAvailable,
  latestVersion,
}: VersionInfoSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="border-t border-border/50 pt-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
            <MessageSquare className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">CloudCLI</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                v{currentVersion}
              </span>
              {updateAvailable && latestVersion && (
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                  {t('apiKeys.version.updateAvailable', { version: latestVersion })}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              AI coding assistant interface
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
