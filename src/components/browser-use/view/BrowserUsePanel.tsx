import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Download, ExternalLink, Globe, Loader2, MonitorPlay, Navigation, Pause, RefreshCw, Share2, Square, X } from 'lucide-react';

import { Badge, Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  runtime: 'cloud' | 'local';
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  sessionCount: number;
  agentToolsEnabled: boolean;
  mcpRecommended: boolean;
  message: string;
};

type BrowserUseSession = {
  id: string;
  runtime: 'cloud' | 'local';
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  agentAccessEnabled: boolean;
  createdBy: 'user' | 'agent';
  profileName: string | null;
};

type BrowserUsePanelProps = {
  isVisible: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function BrowserUsePanel({ isVisible }: BrowserUsePanelProps) {
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [sessions, setSessions] = useState<BrowserUseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [isBusy, setIsBusy] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const refresh = useCallback(async () => {
    const [statusResponse, sessionsResponse] = await Promise.all([
      authenticatedFetch('/api/browser-use/status'),
      authenticatedFetch('/api/browser-use/sessions'),
    ]);
    const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
    const sessionsData = await readJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
    setStatus(statusData.data);
    setSessions(sessionsData.data.sessions);
    setSelectedSessionId((current) => (
      current && sessionsData.data.sessions.some((session) => session.id === current)
        ? current
        : sessionsData.data.sessions[0]?.id || null
    ));
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Browser Use'));
  }, [isVisible, refresh]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser Use action failed');
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const createSession = () => runAction(async () => {
    const response = await authenticatedFetch('/api/browser-use/sessions', { method: 'POST' });
    const data = await readJson<{ data: { session: BrowserUseSession } }>(response);
    setSelectedSessionId(data.data.session.id);
  });

  const navigate = () => runAction(async () => {
    if (!selectedSession) {
      throw new Error('Create a browser session first.');
    }
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url: targetUrl }),
    });
    await readJson(response);
  });

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/stop`, { method: 'POST' });
    await readJson(response);
  });

  const grantAgentAccess = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/agent-access/grant`, { method: 'POST' });
    await readJson(response);
  });

  const revokeAgentAccess = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/agent-access/revoke`, { method: 'POST' });
    await readJson(response);
  });

  const installRuntime = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response);
    } finally {
      setIsInstalling(false);
    }
  });

  const canInstallRuntime = Boolean(status?.enabled && (!status.playwrightInstalled || !status.chromiumInstalled));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Browser Use</h3>
            {status && (
              <Badge variant="outline" className="text-[11px]">
                {status.runtime}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Create browser sessions, watch agent activity, and decide which sessions agents may control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isBusy}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={createSession} disabled={isBusy || !status?.available}>
            <Globe className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-border/60 p-3 lg:border-b-0 lg:border-r">
          <div className="rounded-lg border border-border/70 bg-card/40 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime</div>
            <div className="mt-2 text-sm text-foreground">{status?.available ? 'Available' : 'Setup required'}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status?.message || 'Loading Browser Use status...'}</p>
            {status?.enabled && (
              <div className="mt-3 rounded-md border border-border/70 bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                Agent tools: {status.agentToolsEnabled ? 'enabled' : 'disabled in settings'}
              </div>
            )}
            {canInstallRuntime && (
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                onClick={installRuntime}
                disabled={isBusy || isInstalling || status?.installInProgress}
              >
                {isInstalling || status?.installInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Install Runtime
              </Button>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              Agents can create their own browser sessions when browser tools are enabled. Use
              <span className="font-medium text-foreground"> Give Agent Access </span>
              to let agents control a session you created, and revoke access whenever you want.
            </div>
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selectedSession?.id === session.id
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border/60 bg-card/30 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{session.title || session.url || 'Browser session'}</span>
                  <Badge variant="outline" className="text-[10px]">{session.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {session.createdBy === 'agent' && (
                    <span className="rounded border border-primary/30 px-1.5 py-0.5 text-[10px] text-primary">agent</span>
                  )}
                  {session.agentAccessEnabled && (
                    <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                      shared
                    </span>
                  )}
                  {session.profileName && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">profile: {session.profileName}</span>
                  )}
                </div>
                <div className="mt-1 truncate text-xs">{session.url || session.message || session.id}</div>
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                No browser sessions yet.
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <input
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              placeholder="https://example.com"
            />
            <Button variant="outline" size="sm" onClick={navigate} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
              <Navigation className="h-4 w-4" />
              Go
            </Button>
            {selectedSession?.agentAccessEnabled ? (
              <Button variant="outline" size="sm" onClick={revokeAgentAccess} disabled={isBusy || !selectedSession}>
                <X className="h-4 w-4" />
                Revoke Agent
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={grantAgentAccess} disabled={isBusy || !selectedSession || !status?.agentToolsEnabled}>
                <Share2 className="h-4 w-4" />
                Give Agent Access
              </Button>
            )}
            <Button variant="outline" size="sm" disabled>
              <Pause className="h-4 w-4" />
              Pause
            </Button>
            <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession}>
              <Square className="h-4 w-4" />
              Stop
            </Button>
          </div>

          {error && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
            <div className="mx-auto flex min-h-[420px] max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="truncate">{selectedSession?.url || 'No page loaded'}</span>
                {selectedSession?.agentAccessEnabled && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-500/30 px-2 py-0.5 text-emerald-600 dark:text-emerald-300">
                    <Bot className="h-3.5 w-3.5" />
                    Agent access active
                  </span>
                )}
              </div>
              <div className="flex min-h-[360px] flex-1 items-center justify-center bg-neutral-950">
                {selectedSession?.screenshotDataUrl ? (
                  <img
                    src={selectedSession.screenshotDataUrl}
                    alt="Browser session screenshot"
                    className="h-full max-h-[70vh] w-full object-contain"
                  />
                ) : (
                  <div className="max-w-md px-6 text-center">
                    <MonitorPlay className="mx-auto h-10 w-10 text-neutral-500" />
                    <div className="mt-3 text-sm font-medium text-neutral-100">
                      {selectedSession?.message || 'Create a browser session to start.'}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                      Install the Browser Use runtime from this panel or enable it from Settings.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
