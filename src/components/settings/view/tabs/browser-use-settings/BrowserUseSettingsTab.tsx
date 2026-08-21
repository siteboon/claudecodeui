import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

type BrowserUseSettings = {
  enabled: boolean;
};

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  message: string;
};

async function readJson<T>(response: Response, fallbackError: string): Promise<T> {
  // An empty or malformed body rejects before the status check below, so a
  // parse failure must surface the localized fallback instead of a raw
  // SyntaxError message.
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackError);
  }
  // JSON null, arrays and primitives would raise a TypeError on the field
  // access below; treat them like a failed request.
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(fallbackError);
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || fallbackError);
  }
  return data as T;
}

export default function BrowserUseSettingsTab() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<BrowserUseSettings | null>(null);
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const settingsResponse = await authenticatedFetch('/api/browser-use/settings');
    const settingsData = await readJson<{ data: { settings: BrowserUseSettings } }>(
      settingsResponse,
      t('browserUseSettings.loadSettingsFailed'),
    );
    setSettings(settingsData.data.settings);
  }, [t]);

  const loadStatus = useCallback(async () => {
    const statusResponse = await authenticatedFetch('/api/browser-use/status');
    const statusData = await readJson<{ data: BrowserUseStatus }>(
      statusResponse,
      t('browserUseSettings.loadStatusFailed'),
    );
    setStatus(statusData.data);
  }, [t]);

  useEffect(() => {
    setError(null);
    setIsSettingsLoading(true);
    setIsStatusLoading(true);

    void loadSettings()
      .catch((err) => setError(err instanceof Error ? err.message : t('browserUseSettings.loadSettingsFailed')))
      .finally(() => setIsSettingsLoading(false));

    void loadStatus()
      .catch((err) => setError(err instanceof Error ? err.message : t('browserUseSettings.loadStatusFailed')))
      .finally(() => setIsStatusLoading(false));
  }, [loadSettings, loadStatus, t]);

  const updateSettings = async (nextSettings: Partial<BrowserUseSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      const data = await readJson<{ data: { settings: BrowserUseSettings } }>(
        response,
        t('browserUseSettings.saveFailed'),
      );
      setSettings(data.data.settings);
      window.dispatchEvent(new Event('browserUseSettingsChanged'));
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('browserUseSettings.saveFailed'));
    } finally {
      setIsStatusLoading(false);
      setIsSaving(false);
    }
  };

  const installBrowserBinaries = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response, t('browserUseSettings.installFailed'));
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('browserUseSettings.installFailed'));
    } finally {
      setIsStatusLoading(false);
      setIsInstalling(false);
    }
  };

  const browserEnabled = settings?.enabled === true;
  const needsBrowserBinaries = Boolean(browserEnabled && status && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = (installed?: boolean) => {
    if (isStatusLoading && !status) {
      return t('browserUseSettings.checking');
    }
    return installed ? t('browserUseSettings.installed') : t('browserUseSettings.missing');
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('browserUseSettings.sectionTitle')}
        description={t('browserUseSettings.sectionDescription')}
      >
        <SettingsCard divided>
          <SettingsRow
            label={t('browserUseSettings.enableLabel')}
            description={t('browserUseSettings.enableDescription')}
          >
            {isSettingsLoading && !settings ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={browserEnabled}
                onChange={(value) => void updateSettings({ enabled: value })}
                ariaLabel={t('browserUseSettings.enableAriaLabel')}
                disabled={isSaving}
              />
            )}
          </SettingsRow>

          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUseSettings.playwrightLabel')}: {runtimeLabel(status?.playwrightInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUseSettings.chromiumLabel')}: {runtimeLabel(status?.chromiumInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUseSettings.statusPrefix')}: {isStatusLoading && !status
                  ? t('browserUseSettings.checking')
                  : status?.available
                    ? t('browserUseSettings.ready')
                    : browserEnabled
                      ? t('browserUseSettings.setupRequired')
                      : t('browserUseSettings.disabled')}
              </span>
            </div>

            {needsBrowserBinaries && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('browserUseSettings.runtimeRequiredTitle')}</div>
                  <p className="text-sm text-muted-foreground">
                    {status?.message || t('browserUseSettings.runtimeRequiredFallback')}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void installBrowserBinaries()}
                  disabled={isInstalling || status?.installInProgress}
                  className="flex-shrink-0"
                >
                  {isInstalling || status?.installInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isInstalling || status?.installInProgress
                    ? t('browserUseSettings.installing')
                    : t('browserUseSettings.installRuntime')}
                </Button>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
