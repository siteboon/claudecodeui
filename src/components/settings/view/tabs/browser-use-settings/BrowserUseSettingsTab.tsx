import { useCallback, useEffect, useState } from 'react';
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

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function BrowserUseSettingsTab() {
  const [settings, setSettings] = useState<BrowserUseSettings>({ enabled: false });
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setError(null);
    const [settingsResponse, statusResponse] = await Promise.all([
      authenticatedFetch('/api/browser-use/settings'),
      authenticatedFetch('/api/browser-use/status'),
    ]);
    const settingsData = await readJson<{ data: { settings: BrowserUseSettings } }>(settingsResponse);
    const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
    setSettings(settingsData.data.settings);
    setStatus(statusData.data);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void loadState()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser Use settings'))
      .finally(() => setIsLoading(false));
  }, [loadState]);

  const updateSettings = async (nextSettings: Partial<BrowserUseSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      const data = await readJson<{ data: { settings: BrowserUseSettings } }>(response);
      setSettings(data.data.settings);
      window.dispatchEvent(new Event('browserUseSettingsChanged'));
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Browser Use settings');
    } finally {
      setIsSaving(false);
    }
  };

  const installBrowserBinaries = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install browser runtime');
    } finally {
      setIsInstalling(false);
    }
  };

  const needsBrowserBinaries = Boolean(settings.enabled && status && (!status.playwrightInstalled || !status.chromiumInstalled));

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Browser Use"
        description="Allow agents to create guarded Playwright browser sessions that you can monitor from the Browser Use tab."
      >
        <SettingsCard divided>
          <SettingsRow
            label="Enable Browser Use"
            description="Registers Browser Use for supported agents. Agents can create browser sessions; you can watch, stop, and delete them."
          >
            <SettingsToggle
              checked={settings.enabled}
              onChange={(value) => void updateSettings({ enabled: value })}
              ariaLabel="Enable Browser Use"
              disabled={isLoading || isSaving}
            />
          </SettingsRow>

          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                Playwright: {status?.playwrightInstalled ? 'installed' : 'missing'}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Chromium: {status?.chromiumInstalled ? 'installed' : 'missing'}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Status: {status?.available ? 'ready' : settings.enabled ? 'setup required' : 'disabled'}
              </span>
            </div>

            {needsBrowserBinaries && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">Browser runtime required</div>
                  <p className="text-sm text-muted-foreground">
                    {status?.message || 'Install the browser runtime before agents can create Browser Use sessions.'}
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
                  {isInstalling || status?.installInProgress ? 'Installing...' : 'Install Runtime'}
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
