import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

type ComputerUseSettings = {
  enabled: boolean;
  agentToolsEnabled: boolean;
};

type ComputerUseStatus = {
  enabled: boolean;
  runtime: 'cloud' | 'local';
  available: boolean;
  nutInstalled: boolean;
  screenshotInstalled: boolean;
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

export default function ComputerUseSettingsTab() {
  const [settings, setSettings] = useState<ComputerUseSettings>({ enabled: false, agentToolsEnabled: false });
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

  useEffect(() => {
    setIsLoading(true);
    void loadState()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Computer Use settings'))
      .finally(() => setIsLoading(false));
  }, [loadState]);

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
  const needsRuntime = Boolean(settings.enabled && !isCloud && status && (!status.nutInstalled || !status.screenshotInstalled));

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Computer Use"
        description="Let agents see your desktop and drive the mouse and keyboard through a guarded, consent-gated control loop."
      >
        <SettingsCard divided>
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Computer Use can control your entire desktop. Agents act only while you grant control from the
              Computer panel, and any action stops the moment you press Stop.
            </div>
          </div>

          <SettingsRow
            label="Enable Computer Use"
            description="Registers Computer Use for supported agents and allows CloudCLI to create guarded desktop control sessions on this machine."
          >
            <SettingsToggle
              checked={settings.enabled}
              onChange={(value) => void updateSettings({ enabled: value, agentToolsEnabled: value })}
              ariaLabel="Enable Computer Use"
              disabled={isLoading || isSaving}
            />
          </SettingsRow>

          {(needsRuntime || isCloud || error) && (
            <div className="space-y-4 px-4 py-4">
              {isCloud && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {status?.message || 'Cloud Computer Use requires a linked CloudCLI Desktop Agent on the user machine.'}
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
