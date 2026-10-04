import { useEffect, useState } from 'react';
import { Coffee, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type KeepAwakeStatus = {
  enabled: boolean;
  supported: boolean;
  active: boolean;
};

/**
 * Rendered by NotificationsSettingsTab, next to the other settings for runs that
 * go on while the user is away: keeps the computer the server runs on out of
 * idle sleep while agents work.
 */
export default function KeepAwakeSettingsCard() {
  const { t } = useTranslation('settings');
  // The server's answer: the saved choice and whether this machine supports it. Null until loaded.
  const [status, setStatus] = useState<KeepAwakeStatus | null>(null);
  // Blocks a second toggle while the previous save is still in flight.
  const [isSaving, setIsSaving] = useState(false);
  // The translation key of the last load or save failure, shown under the description.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    api.system.keepAwake()
      .then((response) => readApiJson<{ data: KeepAwakeStatus }>(response))
      .then((payload) => {
        if (isMounted) {
          setStatus(payload.data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorKey('keepAwake.loadFailed');
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const saveEnabled = async (enabled: boolean) => {
    setIsSaving(true);
    setErrorKey(null);
    try {
      const payload = await readApiJson<{ data: KeepAwakeStatus }>(await api.system.saveKeepAwake(enabled));
      setStatus(payload.data);
    } catch {
      setErrorKey('keepAwake.saveFailed');
    } finally {
      setIsSaving(false);
    }
  };

  const isUnsupported = status?.supported === false;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Top-aligned so the icon stays on the first line when the title wraps on phones. */}
          <div className="flex items-start gap-2">
            <Coffee className="mt-1 h-4 w-4 flex-shrink-0 text-blue-600" />
            <h4 className="font-medium text-foreground">{t('keepAwake.title')}</h4>
          </div>
          <p className="text-sm text-muted-foreground">{t('keepAwake.description')}</p>
        </div>
        <div className="flex-shrink-0 pt-0.5">
          {status ? (
            <SettingsToggle
              checked={status.enabled && !isUnsupported}
              onChange={(value) => void saveEnabled(value)}
              ariaLabel={t('keepAwake.title')}
              disabled={isSaving || isUnsupported}
            />
          ) : !errorKey && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
      {isUnsupported && (
        <p className="text-sm text-amber-600 dark:text-amber-400">{t('keepAwake.unsupported')}</p>
      )}
      {errorKey && <p className="text-sm text-red-600 dark:text-red-400">{t(errorKey)}</p>}
    </div>
  );
}
