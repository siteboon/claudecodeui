import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Clock3, Download, Expand, ExternalLink, Loader2, MonitorPlay, RefreshCw, Settings, Square, Trash2, X } from 'lucide-react';

import { Badge, Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  sessionCount: number;
  message: string;
};

type BrowserUseSession = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  createdBy: 'agent';
  profileName: string | null;
  viewport: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent';
  } | null;
};

type BrowserUsePanelProps = {
  isVisible: boolean;
  onShowSettings?: () => void;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'Never';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 'Unknown';
  }

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 10) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
}

function getDomain(url: string | null): string {
  if (!url) {
    return 'No page loaded';
  }

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatAction(action: string | null): string {
  if (!action) {
    return 'Waiting';
  }
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}

function getStatusTone(status: BrowserUseSession['status']): string {
  if (status === 'ready') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (status === 'stopped') {
    return 'border-border bg-muted text-muted-foreground';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

const PROMPTS = [
  'Use Browser Use to open the staging checkout flow, try the main path, and summarize anything that looks broken.',
  'Use Browser Use to inspect the page at <url>, capture what changed after each click, and report UI issues with screenshots.',
];

export default function BrowserUsePanel({ isVisible, onShowSettings }: BrowserUsePanelProps) {
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [sessions, setSessions] = useState<BrowserUseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [statusResponse, sessionsResponse] = await Promise.all([
        authenticatedFetch('/api/browser-use/status'),
        authenticatedFetch('/api/browser-use/sessions'),
      ]);
      const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
      const sessionsData = await readJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
      const nextSessions = sessionsData.data.sessions;
      setStatus(statusData.data);
      setSessions(nextSessions);
      setSelectedSessionId((current) => (
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id || null
      ));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Browser Use');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    void refresh();
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

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/stop`, { method: 'POST' });
    await readJson(response);
  });

  const deleteSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}`, { method: 'DELETE' });
    await readJson(response);
    setIsFullscreen(false);
  });

  const installBrowserBinaries = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJson(response);
    } finally {
      setIsInstalling(false);
    }
  });

  const needsBrowserBinaries = Boolean(status?.enabled && (!status.playwrightInstalled || !status.chromiumInstalled));
  const activeSessions = sessions.filter((session) => session.status === 'ready');
  const inactiveSessions = sessions.filter((session) => session.status !== 'ready');
  const statusLabel = !status?.enabled
    ? 'Disabled'
    : status.available
      ? 'Ready'
      : status.installInProgress || isInstalling
        ? 'Installing'
        : 'Setup required';

  const cursorStyle = selectedSession?.cursor && selectedSession.viewport
    ? {
      left: `${(selectedSession.cursor.x / selectedSession.viewport.width) * 100}%`,
      top: `${(selectedSession.cursor.y / selectedSession.viewport.height) * 100}%`,
    }
    : null;

  const renderSessionItem = (session: BrowserUseSession) => (
    <button
      key={session.id}
      type="button"
      onClick={() => setSelectedSessionId(session.id)}
      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${selectedSession?.id === session.id
        ? 'border-primary/50 bg-primary/10 text-foreground'
        : 'border-border/60 bg-card/30 text-muted-foreground hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{session.title || getDomain(session.url)}</span>
        <Badge variant="outline" className={`text-[10px] ${getStatusTone(session.status)}`}>{session.status}</Badge>
      </div>
      <div className="mt-1 truncate text-xs">{session.url || session.message || session.id}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock3 className="h-3 w-3" />
        <span>{formatRelativeTime(session.updatedAt)}</span>
        {session.lastAction && <span className="truncate">- {formatAction(session.lastAction)}</span>}
      </div>
    </button>
  );

  const renderBrowserSurface = (fullscreen = false) => (
    <div className={`flex min-h-[360px] flex-1 items-center justify-center bg-neutral-950 ${fullscreen ? 'min-h-[80vh]' : ''}`}>
      {selectedSession?.screenshotDataUrl ? (
        <div className="relative inline-block max-h-full">
          <img
            src={selectedSession.screenshotDataUrl}
            alt="Browser session screenshot"
            className={fullscreen ? 'block max-h-[80vh] w-auto max-w-full object-contain' : 'block max-h-[70vh] w-auto max-w-full object-contain'}
          />
          {cursorStyle && (
            <div
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-sky-500/80 shadow-[0_0_0_6px_rgba(14,165,233,0.18)]"
              style={cursorStyle}
            >
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-md px-6 text-center">
          <MonitorPlay className="mx-auto h-10 w-10 text-neutral-500" />
          <div className="mt-3 text-sm font-medium text-neutral-100">
            {selectedSession?.message || 'No browser screenshot yet.'}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            Agent-created browser sessions appear here after the agent starts using Browser Use.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Browser Use</h3>
            <Badge variant="outline" className="text-[10px]">{statusLabel}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Watch browser sessions created by AI agents and stop them when needed.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onShowSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onShowSettings}
              title="Open Browser Use settings"
              aria-label="Open Browser Use settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => void refresh()}
            disabled={isRefreshing || isBusy}
            title="Refresh browser sessions"
            aria-label="Refresh browser sessions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-border/60 p-3 lg:border-b-0 lg:border-r">
          {needsBrowserBinaries && (
            <div className="mb-3 rounded-md border border-border/70 bg-card/40 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime required</div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {status?.message || 'Install the browser runtime before agents can create sessions.'}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                onClick={installBrowserBinaries}
                disabled={isBusy || isInstalling || status?.installInProgress}
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

          <div className="rounded-md border border-border/70 bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              Prompt ideas
            </div>
            <div className="mt-2 space-y-2">
              {PROMPTS.map((prompt) => (
                <div key={prompt} className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                  {prompt}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <section>
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Active</span>
                <span>{activeSessions.length}</span>
              </div>
              <div className="space-y-2">
                {activeSessions.map(renderSessionItem)}
                {activeSessions.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    No active agent sessions.
                  </div>
                )}
              </div>
            </section>

            {inactiveSessions.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Inactive</span>
                  <span>{inactiveSessions.length}</span>
                </div>
                <div className="space-y-2">
                  {inactiveSessions.map(renderSessionItem)}
                </div>
              </section>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          {error && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {selectedSession?.title || getDomain(selectedSession?.url || null)}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{selectedSession?.url || 'No page loaded'}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsFullscreen(true)} disabled={!selectedSession?.screenshotDataUrl}>
              <Expand className="h-4 w-4" />
              Full Screen
            </Button>
            <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
              <Square className="h-4 w-4" />
              Stop
            </Button>
            <Button variant="outline" size="sm" onClick={deleteSession} disabled={isBusy || !selectedSession}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
            <div className="mx-auto flex min-h-[420px] max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <Badge variant="outline" className={selectedSession ? `text-[10px] ${getStatusTone(selectedSession.status)}` : 'text-[10px]'}>
                  {selectedSession?.status || 'empty'}
                </Badge>
                <span className="truncate">Last action: {formatAction(selectedSession?.lastAction || null)}</span>
                <span className="ml-auto whitespace-nowrap">Updated {formatRelativeTime(selectedSession?.updatedAt || null)}</span>
              </div>
              {renderBrowserSurface()}
            </div>
          </div>
        </main>
      </div>

      {isFullscreen && selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/90 p-6">
          <div className="flex h-full flex-col rounded-md border border-white/10 bg-black">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-white/80">
              <div className="min-w-0 truncate">{selectedSession.title || selectedSession.url || 'Browser session'}</div>
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>
            {renderBrowserSurface(true)}
          </div>
        </div>
      )}
    </div>
  );
}
