import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Layers3,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Terminal,
} from 'lucide-react';

import { Badge, Button, HelpTooltip } from '../../../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../../../utils/api';
import SettingsCard from '../../../../SettingsCard';
import SettingsSection from '../../../../SettingsSection';

type GatewayProfile = {
  name: string;
  current: boolean;
  model: string | null;
  gateway: string | null;
  alias: string | null;
  distribution: string | null;
};

type GatewayStatus = {
  installed: boolean;
  command: string;
  version: string | null;
  running: boolean;
  managedByCloudCLI: boolean;
  state: 'running' | 'stopped' | 'unknown';
  statusOutput: string;
  profiles: GatewayProfile[];
  logs: string[];
  lastExit: {
    code: number | null;
    signal: string | null;
    at: string;
  } | null;
  commands: {
    setup: string;
    run: string;
  };
};

type ApiSuccess<T> = {
  success: boolean;
  data: T;
};

type GatewayContentProps = {
  onOpenSetup: (customCommand?: string, customTitle?: string) => void;
};

const gatewayTooltip = 'Use this when tools outside CloudCLI need to reach Hermes through messaging integrations. Normal CloudCLI chat uses the built-in agent API.';
const setupTooltip = 'Opens Hermes setup in the terminal so you can connect Telegram, Discord, WhatsApp, or another supported platform.';
const profilesTooltip = 'Profiles are isolated Hermes configurations. This page shows them for visibility and controls the active gateway process.';
const logsTooltip = 'These logs come from the gateway process started by CloudCLI in this server session.';

async function readGatewayResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | { error?: string } | null;
  if (!response.ok || !payload || !('success' in payload) || !payload.success) {
    throw new Error((payload && 'error' in payload && payload.error) || 'Gateway request failed');
  }

  return payload.data;
}

export default function GatewayContent({ onOpenSetup }: GatewayContentProps) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setError(null);
    try {
      const response = await authenticatedFetch('/api/providers/hermes/gateway/status');
      const nextStatus = await readGatewayResponse<GatewayStatus>(response);
      setStatus(nextStatus);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not load gateway status');
    } finally {
      setLoading(false);
    }
  }, []);

  const runAction = useCallback(async (nextAction: 'start' | 'stop' | 'restart') => {
    setAction(nextAction);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/providers/hermes/gateway/${nextAction}`, {
        method: 'POST',
      });
      const nextStatus = await readGatewayResponse<GatewayStatus>(response);
      setStatus(nextStatus);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Could not ${nextAction} gateway`);
      void refreshStatus();
    } finally {
      setAction(null);
    }
  }, [refreshStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const busy = Boolean(action);
  const running = Boolean(status?.running);

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
          <Activity className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium text-foreground">Hermes Gateway</h3>
            <HelpTooltip content={gatewayTooltip} position="right" />
          </div>
          <p className="text-sm text-muted-foreground">
            Manage Hermes messaging gateway runtime for the active environment.
          </p>
        </div>
      </div>

      <SettingsSection
        title="Runtime"
        description="Start the gateway in the current CloudCLI server environment."
      >
        <SettingsCard>
          <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={running
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}
                >
                  {loading ? 'Checking' : running ? 'Running' : 'Stopped'}
                </Badge>
                {status?.managedByCloudCLI && (
                  <Badge variant="outline">Managed by CloudCLI</Badge>
                )}
                {status && !status.installed && (
                  <Badge variant="destructive">Hermes not installed</Badge>
                )}
              </div>

              <div className="space-y-1 text-sm">
                <div className="text-foreground">
                  Command: <span className="font-mono text-muted-foreground">{status?.command ?? 'hermes'}</span>
                </div>
                <div className="text-muted-foreground">
                  {status?.version ?? 'Hermes status will appear after refresh.'}
                </div>
                {status?.lastExit && (
                  <div className="text-muted-foreground">
                    Last exit: code {status.lastExit.code ?? 'null'}
                    {status.lastExit.signal ? `, signal ${status.lastExit.signal}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshStatus()}
                disabled={loading || busy}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void runAction('start')}
                disabled={!status?.installed || running || busy}
              >
                <Play className="h-4 w-4" />
                {action === 'start' ? 'Starting' : 'Start'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runAction('restart')}
                disabled={!status?.installed || busy}
              >
                <RotateCcw className="h-4 w-4" />
                {action === 'restart' ? 'Restarting' : 'Restart'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runAction('stop')}
                disabled={!status?.installed || !running || busy}
              >
                <Square className="h-4 w-4" />
                {action === 'stop' ? 'Stopping' : 'Stop'}
              </Button>
            </div>
          </div>

          {status?.statusOutput && (
            <div className="border-t border-border px-4 py-3">
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {status.statusOutput}
              </pre>
            </div>
          )}

          {error && (
            <div className="border-t border-border px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Setup"
        description="Configure messaging platforms through the Hermes CLI."
      >
        <SettingsCard>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                Platform setup
                <HelpTooltip content={setupTooltip} position="right" />
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Opens <span className="font-mono">hermes gateway setup</span> in the shell.
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => onOpenSetup('hermes gateway setup', 'Hermes Gateway Setup')}
            >
              <Terminal className="h-4 w-4" />
              Open setup
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Profiles"
        description="View Hermes profiles detected in this environment."
      >
        <SettingsCard>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            <Layers3 className="h-4 w-4 text-muted-foreground" />
            Hermes profiles
            <HelpTooltip content={profilesTooltip} position="right" />
          </div>
          {status?.profiles.length ? (
            <div className="divide-y divide-border">
              {status.profiles.map((profile) => (
                <div key={profile.name} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      {profile.name}
                      {profile.current && <Badge variant="outline">Current</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">
                      {profile.model ?? 'No model configured'}
                    </div>
                  </div>
                  <div className="text-muted-foreground">
                    Gateway: {profile.gateway ?? 'unknown'}
                  </div>
                  <div className="text-muted-foreground">
                    Alias: {profile.alias ?? 'none'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              {loading ? 'Loading profiles...' : 'No Hermes profiles were found.'}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Logs"
        description="Recent output from the gateway process managed by CloudCLI."
      >
        <SettingsCard>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            Gateway output
            <HelpTooltip content={logsTooltip} position="right" />
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {status?.logs.length ? status.logs.join('\n') : 'No CloudCLI-managed gateway logs yet.'}
          </pre>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
