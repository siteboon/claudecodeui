import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

type BrowserUseSettings = {
  enabled: boolean;
  agentToolsEnabled: boolean;
};

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  agentToolsEnabled: boolean;
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
  const [settings, setSettings] = useState<BrowserUseSettings>({ enabled: false, agentToolsEnabled: false });
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
      setError(err instanceof Error ? err.message : 'Failed to install browser binaries');
    } finally {
      setIsInstalling(false);
    }
  };

  const needsBrowserBinaries = Boolean(settings.enabled && status && (!status.playwrightInstalled || !status.chromiumInstalled));

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Browser Use"
        description="Manage local Playwright browser sessions used for captured browser screenshots and guarded navigation."
      >
        <SettingsCard divided>
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">How Browser Use Works</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Learn what agents can do with browser sessions, when to share access, and what the current limitations are.
              </p>
            </div>
            <a
              href="https://cloudcli.ai/docs/user-guide/browser-use"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Open Guide
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <SettingsRow
            label="Enable Browser Use"
            description="Allow CloudCLI to create owner-scoped Playwright browser sessions."
          >
            <SettingsToggle
              checked={settings.enabled}
              onChange={(value) => void updateSettings({ enabled: value })}
              ariaLabel="Enable Browser Use"
              disabled={isLoading || isSaving}
            />
          </SettingsRow>

          <SettingsRow
            label="Enable Browser Tools for Agents"
            description="Register the Browser Use MCP server for all agent providers. Agents can create browser sessions and control sessions shared with agents."
          >
            <SettingsToggle
              checked={settings.agentToolsEnabled}
              onChange={(value) => void updateSettings({ agentToolsEnabled: value })}
              ariaLabel="Enable Browser Tools for Agents"
              disabled={isLoading || isSaving || !settings.enabled}
            />
          </SettingsRow>

          {(needsBrowserBinaries || error) && (
            <div className="space-y-4 px-4 py-4">
              {needsBrowserBinaries && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium text-foreground">Browser binaries required</div>
                    <p className="text-sm text-muted-foreground">
                      {status?.message || 'Install the browser binaries needed to create Browser Use sessions.'}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                      <span className="rounded-md border border-border px-2 py-1">
                        Playwright: {status?.playwrightInstalled ? 'installed' : 'missing'}
                      </span>
                      <span className="rounded-md border border-border px-2 py-1">
                        Chromium: {status?.chromiumInstalled ? 'installed' : 'missing'}
                      </span>
                    </div>
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
                    {isInstalling || status?.installInProgress ? 'Installing…' : 'Install Binaries'}
                  </Button>
                </div>
              )}

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {error}
                </div>
              )}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
