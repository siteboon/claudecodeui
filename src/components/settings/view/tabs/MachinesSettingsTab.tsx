import { Copy, Plus, Server, Trash2, Wifi } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type MachineRecord = {
  id: string;
  name: string;
  tokenPrefix: string;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
  hostname: string | null;
  createdAt: string;
};

type CreateMachineResponse = {
  success: boolean;
  data: {
    machine: MachineRecord;
    token: string;
  };
};

type ListMachinesResponse = {
  success: boolean;
  data: {
    machines: MachineRecord[];
  };
};

type PingMachineResponse = {
  success: boolean;
  data: {
    machineId: string;
    ok: boolean;
    latencyMs: number;
    payload: string;
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload as T;
}

export default function MachinesSettingsTab() {
  const { t } = useTranslation('settings');
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newMachineName, setNewMachineName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<string | null>(null);

  const loadMachines = useCallback(async () => {
    const response = await authenticatedFetch('/api/machines');
    const payload = await readJson<ListMachinesResponse>(response);
    setMachines(payload.data.machines);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void loadMachines()
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    const timer = window.setInterval(() => {
      void loadMachines().catch(() => undefined);
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadMachines]);

  const handleCreate = async () => {
    setError(null);
    setPingResult(null);
    try {
      const response = await authenticatedFetch('/api/machines', {
        method: 'POST',
        body: JSON.stringify({ name: newMachineName }),
      });
      const payload = await readJson<CreateMachineResponse>(response);
      setCreatedToken(payload.data.token);
      setNewMachineName('');
      setShowCreateForm(false);
      await loadMachines();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const handleRevoke = async (machineId: string) => {
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/machines/${encodeURIComponent(machineId)}`, {
        method: 'DELETE',
      });
      await readJson(response);
      if (createdToken) {
        setCreatedToken(null);
      }
      await loadMachines();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : String(revokeError));
    }
  };

  const handlePing = async (machineId: string) => {
    setError(null);
    setPingResult(null);
    try {
      const response = await authenticatedFetch(`/api/machines/${encodeURIComponent(machineId)}/ping`, {
        method: 'POST',
      });
      const payload = await readJson<PingMachineResponse>(response);
      setPingResult(
        t('machines.pingSuccess', {
          defaultValue: 'Ping ok — {{latency}} ms',
          latency: payload.data.latencyMs,
        }),
      );
      await loadMachines();
    } catch (pingError) {
      setError(pingError instanceof Error ? pingError.message : String(pingError));
    }
  };

  const copyToken = async () => {
    if (!createdToken) {
      return;
    }
    await navigator.clipboard.writeText(createdToken);
  };

  return (
    <SettingsSection
      title={t('machines.title', { defaultValue: 'Machines' })}
      description={t('machines.description', {
        defaultValue: 'Register worker machines that connect outbound to this server. Tokens are shown once.',
      })}
    >
      <SettingsCard className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="h-4 w-4" />
            {t('machines.listHint', {
              defaultValue: 'Workers: cloudcli worker start --server <url> --token <mw_...>',
            })}
          </div>
          <Button size="sm" onClick={() => setShowCreateForm((value) => !value)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('machines.newButton', { defaultValue: 'New machine' })}
          </Button>
        </div>

        {showCreateForm && (
          <div className="mb-4 rounded-lg border bg-card p-4">
            <Input
              placeholder={t('machines.form.placeholder', { defaultValue: 'Machine name' })}
              value={newMachineName}
              onChange={(event) => setNewMachineName(event.target.value)}
              className="mb-2"
            />
            <div className="flex gap-2">
              <Button onClick={() => void handleCreate()}>
                {t('machines.form.createButton', { defaultValue: 'Create' })}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewMachineName('');
                }}
              >
                {t('machines.form.cancelButton', { defaultValue: 'Cancel' })}
              </Button>
            </div>
          </div>
        )}

        {createdToken && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="mb-2 text-sm font-medium">
              {t('machines.tokenOnce', {
                defaultValue: 'Copy this token now. It will not be shown again.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                {createdToken}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copyToken()}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {pingResult && <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">{pingResult}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('machines.loading', { defaultValue: 'Loading machines…' })}
          </p>
        ) : machines.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            {t('machines.empty', { defaultValue: 'No machines registered yet.' })}
          </p>
        ) : (
          <div className="space-y-2">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        machine.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                      }`}
                    />
                    <p className="truncate font-medium">{machine.name}</p>
                    <span className="text-xs uppercase text-muted-foreground">{machine.status}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {machine.hostname || '—'} · {machine.tokenPrefix}… · {machine.id}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      localStorage.setItem('selected-machine-id', machine.id);
                      localStorage.setItem('selected-machine-name', machine.name);
                      setPingResult(
                        t('machines.selectedForChat', {
                          defaultValue: 'Selected for new chats: {{name}}',
                          name: machine.name,
                        }),
                      );
                    }}
                  >
                    {t('machines.useForChat', { defaultValue: 'Use for chat' })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={machine.status !== 'online'}
                    onClick={() => void handlePing(machine.id)}
                  >
                    <Wifi className="mr-1 h-4 w-4" />
                    {t('machines.ping', { defaultValue: 'Ping' })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRevoke(machine.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
