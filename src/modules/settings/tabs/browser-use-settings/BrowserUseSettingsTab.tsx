import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/shared/ui';
import { api, readApiJson, ApiRequestError } from '@/shared/api';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

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

const BROWSER_USE_ERROR_KEYS: Record<string, string> = {
  BROWSER_USE_STATUS_LOAD_FAILED: 'browserUseSettings.loadStatusFailed',
  BROWSER_USE_SETTINGS_LOAD_FAILED: 'browserUseSettings.loadSettingsFailed',
  BROWSER_USE_SETTINGS_SAVE_FAILED: 'browserUseSettings.saveFailed',
  BROWSER_USE_SETTINGS_APPLY_FAILED: 'browserUseSettings.applyFailed',
  BROWSER_USE_RUNTIME_INSTALL_FAILED: 'browserUseSettings.installFailed',
};

function localizeApiError(err: unknown, fallbackKey: string, t: (key: string) => string): string {
  if (err instanceof ApiRequestError && err.code && BROWSER_USE_ERROR_KEYS[err.code]) {
    return t(BROWSER_USE_ERROR_KEYS[err.code]);
  }
  return t(fallbackKey);
}

/** Rendered by Settings for the "browser" tab, configuring the browser automation integration. */
export default function BrowserUseSettingsTab() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<BrowserUseSettings | null>(null);
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  // Retain the failed operation so a partially applied setting can be retried.
  const [error, setError] = useState<{ message: string; retrySettings?: boolean } | null>(null);
  const requestVersion = useRef(0);
  // Translation changes must not invalidate an in-flight settings operation.
  const translate = useRef(t);
  translate.current = t;

  const loadSettings = useCallback(async (version: number) => {
    const settingsResponse = await api.browserUse.settings();
    const settingsData = await readApiJson<{ data: { settings: BrowserUseSettings } }>(settingsResponse);
    if (requestVersion.current === version) setSettings(settingsData.data.settings);
  }, []);

  const loadStatus = useCallback(async (version: number) => {
    const statusResponse = await api.browserUse.status();
    const statusData = await readApiJson<{ data: BrowserUseStatus }>(statusResponse);
    if (requestVersion.current === version) setStatus(statusData.data);
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    setError(null);
    setIsSettingsLoading(true);
    setIsStatusLoading(true);

    void loadSettings(version)
      .catch((err) => {
        if (requestVersion.current === version) setError({ message: localizeApiError(err, 'browserUseSettings.loadSettingsFailed', translate.current) });
      })
      .finally(() => { if (requestVersion.current === version) setIsSettingsLoading(false); });

    void loadStatus(version)
      .catch((err) => {
        if (requestVersion.current === version) setError({ message: localizeApiError(err, 'browserUseSettings.loadStatusFailed', translate.current) });
      })
      .finally(() => { if (requestVersion.current === version) setIsStatusLoading(false); });
    return () => { ++requestVersion.current; };
  }, [loadSettings, loadStatus]);

  const updateSettings = async (nextSettings: Partial<BrowserUseSettings>) => {
    const version = ++requestVersion.current;
    let saved = false;
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.browserUse.saveSettings(nextSettings);
      const data = await readApiJson<{ data: { settings: BrowserUseSettings } }>(response);
      if (requestVersion.current !== version) return;
      saved = true;
      setSettings(data.data.settings);
      window.dispatchEvent(new Event('browserUseSettingsChanged'));
      setIsStatusLoading(true);
      await loadStatus(version);
    } catch (err) {
      if (requestVersion.current !== version) return;
      const message = localizeApiError(err, saved ? 'browserUseSettings.loadStatusFailed' : 'browserUseSettings.saveFailed', t);
      setError({ message, retrySettings: err instanceof ApiRequestError && err.code === 'BROWSER_USE_SETTINGS_APPLY_FAILED' });
      // Persistence can succeed before MCP registration fails. Reload both
      // values without replacing the original, useful failure explanation.
      setIsSettingsLoading(true);
      setIsStatusLoading(true);
      const [savedSettings] = await Promise.allSettled([loadSettings(version), loadStatus(version)]);
      if (requestVersion.current !== version) return;
      if (savedSettings.status === 'fulfilled') {
        window.dispatchEvent(new Event('browserUseSettingsChanged'));
      } else {
        setError({ message: `${message} ${t('browserUseSettings.reloadFailed')}` });
      }
    } finally {
      if (requestVersion.current === version) {
        setIsSettingsLoading(false);
        setIsStatusLoading(false);
        setIsSaving(false);
      }
    }
  };

  const installBrowserBinaries = async () => {
    const version = ++requestVersion.current;
    setIsInstalling(true);
    setError(null);
    try {
      const response = await api.browserUse.installRuntime();
      await readApiJson(response);
      if (requestVersion.current !== version) return;
      setIsStatusLoading(true);
      await loadStatus(version);
    } catch (err) {
      if (requestVersion.current === version) setError({ message: localizeApiError(err, 'browserUseSettings.installFailed', t) });
    } finally {
      if (requestVersion.current === version) {
        setIsStatusLoading(false);
        setIsInstalling(false);
      }
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
                disabled={isSaving || isInstalling || isSettingsLoading}
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
                    {t('browserUseSettings.runtimeRequiredFallback')}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void installBrowserBinaries()}
                  disabled={isInstalling || isSaving || status?.installInProgress}
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
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                <p>{error.message}</p>
                {error.retrySettings && settings && (
                  <Button type="button" size="sm" className="mt-2" disabled={isSaving || isInstalling} onClick={() => void updateSettings(settings)}>
                    {t('browserUseSettings.retrySettings')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
