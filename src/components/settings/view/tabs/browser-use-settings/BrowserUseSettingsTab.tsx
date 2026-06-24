import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Eye, Loader2, Zap } from 'lucide-react';

import { Button, Input } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

const BROWSER_USE_GUIDE_URL = 'https://cloudcli.ai/docs/browser-use';

type BrowserUseSettings = {
  enabled: boolean;
  persistSessions: boolean;
  defaultProfileName: string;
  browserBackend: 'playwright' | 'camoufox-vnc';
};

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  backend: 'playwright' | 'camoufox-vnc';
  browserBackend: 'playwright' | 'camoufox-vnc';
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  camoufoxInstalled: boolean;
  noVncInstalled: boolean;
  x11vncInstalled: boolean;
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
  const [settings, setSettings] = useState<BrowserUseSettings | null>(null);
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState('default');

  const loadSettings = useCallback(async () => {
    const settingsResponse = await authenticatedFetch('/api/browser-use/settings');
    const settingsData = await readJson<{ data: { settings: BrowserUseSettings } }>(settingsResponse);
    setSettings(settingsData.data.settings);
    setProfileNameDraft(settingsData.data.settings.defaultProfileName || 'default');
  }, []);

  const loadStatus = useCallback(async () => {
    const statusResponse = await authenticatedFetch('/api/browser-use/status');
    const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
    setStatus(statusData.data);
  }, []);

  useEffect(() => {
    setError(null);
    setIsSettingsLoading(true);
    setIsStatusLoading(true);

    void loadSettings()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser settings'))
      .finally(() => setIsSettingsLoading(false));

    void loadStatus()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser status'))
      .finally(() => setIsStatusLoading(false));
  }, [loadSettings, loadStatus]);

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
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Browser settings');
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
      await readJson(response);
      setIsStatusLoading(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install browser runtime');
    } finally {
      setIsStatusLoading(false);
      setIsInstalling(false);
    }
  };

  const saveProfileName = async () => {
    const nextName = profileNameDraft.trim() || 'default';
    setProfileNameDraft(nextName);
    if (nextName === settings?.defaultProfileName) {
      return;
    }
    await updateSettings({ defaultProfileName: nextName });
  };

  const browserEnabled = settings?.enabled === true;
  const persistSessions = settings?.persistSessions === true;
  const selectedBackend = settings?.browserBackend || 'playwright';
  const effectiveBackend = status?.backend || 'playwright';
  const needsBrowserBinaries = Boolean(browserEnabled && status && !status.available);
  const runtimeLabel = (installed?: boolean) => {
    if (isStatusLoading && !status) {
      return 'checking...';
    }
    return installed ? 'installed' : 'missing';
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Browser"
        description="Give coding agents a working browser so they can open websites, test flows, capture screenshots, and help debug what users actually see."
      >
        <SettingsCard divided>
          <SettingsRow
            label="Give Agents Browser Access"
            description="Let agents use a browser during coding tasks while you can watch live sessions, open them in a tab, and stop them at any time."
          >
            {isSettingsLoading && !settings ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={browserEnabled}
                onChange={(value) => void updateSettings({ enabled: value })}
                ariaLabel="Give Agents Browser Access"
                disabled={isSaving}
              />
            )}
          </SettingsRow>

          {!browserEnabled && (
            <div className="px-4 py-4">
              <a
                href={BROWSER_USE_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                Read the Browser guide
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {browserEnabled && (
            <>
              <div className="space-y-3 px-4 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Browser Engine</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Pick the kind of browser experience agents should use for new sessions.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    {
                      value: 'playwright' as const,
                      label: 'Playwright',
                      description: 'Best for quick checks, screenshots, and automated page interaction when no manual login is needed.',
                      icon: Zap,
                    },
                    {
                      value: 'camoufox-vnc' as const,
                      label: 'Camoufox + noVNC',
                      description: 'Best when a person may need to log in, approve a step, or watch the browser session live.',
                      icon: Eye,
                    },
                  ]).map((option) => {
                    const Icon = option.icon;
                    const selected = selectedBackend === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => void updateSettings({ browserBackend: option.value })}
                        disabled={isSaving || isSettingsLoading}
                        className={[
                          'group flex min-h-[88px] items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                          selected
                            ? 'border-primary bg-primary/5 text-foreground shadow-sm'
                            : 'border-border bg-background hover:border-foreground/20 hover:bg-muted/40',
                          (isSaving || isSettingsLoading) ? 'cursor-not-allowed opacity-60' : '',
                        ].join(' ')}
                        aria-pressed={selected}
                      >
                        <span className={[
                          'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border',
                          selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground',
                        ].join(' ')}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <SettingsRow
                label="Remember Browser Logins"
                description="Keep cookies and site storage in a named profile so agents can reuse signed-in sessions instead of starting from scratch."
              >
                {isSettingsLoading && !settings ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <SettingsToggle
                    checked={persistSessions}
                    onChange={(value) => void updateSettings({ persistSessions: value })}
                    ariaLabel="Remember Browser Logins"
                    disabled={isSaving}
                  />
                )}
              </SettingsRow>

              {persistSessions && (
                <SettingsRow
                  label="Default Browser Profile"
                  description="New browser sessions use this profile by default, so saved logins stay tied to a predictable workspace."
                >
                  <Input
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    onBlur={() => void saveProfileName()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                    disabled={isSaving || isSettingsLoading}
                    className="w-40"
                    aria-label="Default Browser Profile"
                  />
                </SettingsRow>
              )}
            </>
          )}

          {browserEnabled && (
          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                Backend: {effectiveBackend === 'camoufox-vnc' ? 'Camoufox + noVNC' : 'Playwright'}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Playwright: {runtimeLabel(status?.playwrightInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Chromium: {runtimeLabel(status?.chromiumInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Camoufox: {runtimeLabel(status?.camoufoxInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                noVNC: {runtimeLabel(status?.noVncInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Status: {isStatusLoading && !status ? 'checking...' : status?.available ? 'ready' : browserEnabled ? 'setup required' : 'disabled'}
              </span>
            </div>

            {needsBrowserBinaries && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">Browser runtime required</div>
                  <p className="text-sm text-muted-foreground">
                    {status?.message || 'Install the browser runtime before agents can create Browser sessions.'}
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

            <a
              href={BROWSER_USE_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Read the Browser guide
              <ExternalLink className="h-3.5 w-3.5" />
            </a>

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
