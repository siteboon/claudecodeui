import { useCallback, useEffect, useState } from 'react';
import { Cable, MonitorCog, RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge, Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';

type ComputerUseStatus = {
  available: boolean;
  bridgeConnected: boolean;
  runtime: 'cloud' | 'local';
  requiresDesktopBridge: boolean;
  message: string;
  capabilities: {
    screenshots: boolean;
    mouse: boolean;
    keyboard: boolean;
    clipboard: boolean;
    stopControl: boolean;
  };
};

type ComputerUsePanelProps = {
  isVisible: boolean;
};

async function readStatus(response: Response): Promise<ComputerUseStatus> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data.data;
}

export default function ComputerUsePanel({ isVisible }: ComputerUsePanelProps) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await authenticatedFetch('/api/computer-use/status');
      setStatus(await readStatus(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Computer Use status');
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      void refresh();
    }
  }, [isVisible, refresh]);

  const capabilities = status?.capabilities || {
    screenshots: false,
    mouse: false,
    keyboard: false,
    clipboard: false,
    stopControl: false,
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorCog className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Computer Use</h3>
            {status && <Badge variant="outline" className="text-[11px]">{status.runtime}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Local desktop control through a user-approved CloudCLI Desktop Agent.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-border bg-card/40 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Cable className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">Desktop bridge</h4>
                <Badge variant={status?.bridgeConnected ? 'default' : 'outline'} className="text-[11px]">
                  {status?.bridgeConnected ? 'connected' : 'not connected'}
                </Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {status?.message || 'Loading Computer Use status...'}
              </p>
              <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/60 p-4">
                <div className="text-sm font-medium text-foreground">Architecture boundary</div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Hosted CloudCLI can request Computer Use only through a linked local agent. The hosted server should never receive a permanent raw ability to control a user machine.
                </p>
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Required controls</h4>
          </div>
          <div className="mt-3 space-y-2">
            {Object.entries(capabilities).map(([name, enabled]) => (
              <div key={name} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                <span className="capitalize text-foreground">{name.replace(/([A-Z])/g, ' $1')}</span>
                <Badge variant={enabled ? 'default' : 'outline'} className="text-[10px]">
                  {enabled ? 'ready' : 'blocked'}
                </Badge>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
