import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

type ComputerUseSettings = {
  enabled: boolean;
};

type ComputerUseStatus = {
  enabled: boolean;
  runtime: 'cloud' | 'local';
  available: boolean;
  desktopAgentConnected?: boolean;
  desktopAgentCount?: number;
  nutInstalled: boolean;
  screenshotInstalled: boolean;
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

export default function ComputerUseSettingsTab() {
  const [settings, setSettings] = useState<ComputerUseSettings>({ enabled: false });
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setError(null);
    const [settingsResponse, statusResponse] = await Promise.all([
      authenticatedFetch('/api/computer-use/settings'),
      authenticatedFetch('/api/computer-use/status'),
    ]);
    const settingsData = await readJson<{ data: { settings: ComputerUseSettings } }>(settingsResponse);
    const statusData = await readJson<{ data: ComputerUseStatus }>(statusResponse);
    setSettings(settingsData.data.settings);
    setStatus(statusData.data);
  }, []);

  const refreshState = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Computer Use settings');
    } finally {
      setIsLoading(false);
    }
  }, [loadState]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const updateSettings = async (nextSettings: Partial<ComputerUseSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/computer-use/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      const data = await readJson<{ data: { settings: ComputerUseSettings } }>(response);
      setSettings(data.data.settings);
      window.dispatchEvent(new Event('computerUseSettingsChanged'));
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Computer Use settings');
    } finally {
      setIsSaving(false);
    }
  };

  const installRuntime = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/computer-use/runtime/install', { method: 'POST' });
      await readJson(response);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install Computer Use runtime');
    } finally {
      setIsInstalling(false);
    }
  };

  const isCloud = status?.runtime === 'cloud';
  const effectiveEnabled = isCloud ? status?.enabled === true : settings.enabled;
  const needsRuntime = Boolean(effectiveEnabled && !isCloud && status && (!status.nutInstalled || !status.screenshotInstalled));
  const desktopAgentCount = status?.desktopAgentCount ?? (status?.desktopAgentConnected ? 1 : 0);
  const modeDescription = isCloud
    ? 'Let cloud agents request access to your own computer through CloudCLI Desktop.'
    : 'Let local agents request access to this computer.';

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Computer Use"
        description={modeDescription}
      >
        <SettingsCard divided>
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {isCloud
                ? 'A cloud agent can use your desktop only after you approve the request in CloudCLI Desktop. Stop ends access immediately.'
                : 'Agents can use your desktop only while you grant control from the Computer tab. Stop ends access immediately.'}
            </div>
            {effectiveEnabled && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {isCloud
                  ? 'Keep CloudCLI Desktop open on the computer you want agents to use.'
                  : 'Open the Computer tab to review requests, grant control, or stop a session.'}
              </div>
            )}
          </div>

          {isCloud ? (
            <SettingsRow
              label="Cloud desktop access"
              description={status?.desktopAgentConnected
                ? `${desktopAgentCount} ${desktopAgentCount === 1 ? 'desktop app is' : 'desktop apps are'} connected to this environment.`
                : 'Not connected yet. Link happens from CloudCLI Desktop on your computer.'}
            >
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void refreshState()}
                  disabled={isLoading}
                  className="h-8"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <div className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  status?.desktopAgentConnected
                    ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                    : 'border-amber-500/30 text-amber-600 dark:text-amber-300'
                }`}
                >
                  {status?.desktopAgentConnected
                    ? `${desktopAgentCount} linked`
                    : 'Not linked'}
                </div>
              </div>
            </SettingsRow>
          ) : (
            <SettingsRow
              label="Enable Computer Use"
              description="Registers Computer Use for supported agents and allows CloudCLI to create guarded desktop control sessions on this machine."
            >
              <SettingsToggle
                checked={settings.enabled}
                onChange={(value) => void updateSettings({ enabled: value })}
                ariaLabel="Enable Computer Use"
                disabled={isLoading || isSaving}
              />
            </SettingsRow>
          )}

          {(needsRuntime || isCloud || error) && (
            <div className="space-y-4 px-4 py-4">
              {isCloud && !status?.desktopAgentConnected && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">To link this computer</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Open CloudCLI Desktop on the computer you want agents to use.</li>
                    <li>Connect the same CloudCLI account used for this cloud environment.</li>
                    <li>Open Desktop Settings and turn on Computer Use.</li>
                    <li>Keep the desktop app running. This status changes to Desktop linked automatically.</li>
                  </ol>
                </div>
              )}

              {isCloud && status?.desktopAgentConnected && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {desktopAgentCount > 1
                    ? `${desktopAgentCount} desktops are linked. Agents will use one available desktop; stop Computer Use on any desktop you do not want agents to control.`
                    : 'CloudCLI Desktop is linked. Approval prompts will appear there when an agent requests desktop access.'}
                </div>
              )}

              {needsRuntime && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium text-foreground">Desktop runtime required</div>
                    <p className="text-sm text-muted-foreground">
                      {status?.message || 'Install the desktop control runtime needed to capture the screen and drive input.'}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                      <span className="rounded-md border border-border px-2 py-1">
                        Control lib: {status?.nutInstalled ? 'installed' : 'missing'}
                      </span>
                      <span className="rounded-md border border-border px-2 py-1">
                        Screen capture: {status?.screenshotInstalled ? 'installed' : 'missing'}
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void installRuntime()}
                    disabled={isInstalling || status?.installInProgress}
                    className="flex-shrink-0"
                  >
                    {isInstalling || status?.installInProgress ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {isInstalling || status?.installInProgress ? 'Installing…' : 'Install Runtime'}
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
