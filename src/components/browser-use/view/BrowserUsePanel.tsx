import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Clock3,
  Download,
  Expand,
  ExternalLink,
  Loader2,
  MonitorPlay,
  MousePointer2,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Badge, Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';
import type { SettingsMainTab } from '../../settings/types/types';

const BROWSER_USE_GUIDE_URL = 'https://cloudcli.ai/docs/browser-use';
const BROWSER_USE_CACHE_TTL_MS = 30_000;

type BrowserUseStatus = {
  enabled: boolean;
  available: boolean;
  backend: 'playwright' | 'camoufox-vnc';
  browserBackend: 'playwright' | 'camoufox-vnc';
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
  backend?: 'playwright' | 'camoufox-vnc';
  viewerUrl?: string | null;
  viewerEmbedUrl?: string | null;
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
  projectId?: string | null;
  onShowSettings?: (tab?: SettingsMainTab) => void;
};

type BrowserUsePanelCacheEntry = {
  status: BrowserUseStatus | null;
  sessions: BrowserUseSession[];
  selectedSessionId: string | null;
  updatedAt: number;
};

const browserUsePanelCache = new Map<string, BrowserUsePanelCacheEntry>();

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(response.ok ? 'Received an invalid Browser response.' : `Browser request failed (${response.status}).`);
    }
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

async function fetchBrowserPanelData() {
  const [statusResponse, sessionsResponse] = await Promise.all([
    authenticatedFetch('/api/browser-use/status'),
    authenticatedFetch('/api/browser-use/sessions'),
  ]);
  const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse);
  const sessionsData = await readJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
  return {
    status: statusData.data,
    sessions: [...sessionsData.data.sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Never';

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown';

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
  if (!url) return 'No page loaded';

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatAction(action: string | null): string {
  if (!action) return 'Waiting';
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}

function getStatusTone(status: BrowserUseSession['status']): string {
  if (status === 'ready') {
    return 'border-primary/30 bg-primary/5 text-foreground';
  }
  if (status === 'stopped') {
    return 'border-border bg-muted text-muted-foreground';
  }
  return 'border-border bg-background text-muted-foreground';
}

function getRuntimeTone(status: BrowserUseStatus | null, installing: boolean): string {
  if (!status?.enabled) return 'border-border bg-muted text-muted-foreground';
  if (status.available) return 'border-primary/30 bg-primary/5 text-foreground';
  if (status.installInProgress || installing) return 'border-primary/30 bg-primary/5 text-foreground';
  return 'border-border bg-background text-muted-foreground';
}

function getStatusDot(status: BrowserUseSession['status']): string {
  if (status === 'ready') return 'bg-primary';
  if (status === 'stopped') return 'bg-muted-foreground/50';
  return 'bg-border';
}

function getEngineLabel(backend?: BrowserUseStatus['backend'] | BrowserUseSession['backend']): string {
  return backend === 'camoufox-vnc' ? 'Visible browser' : 'Playwright';
}

const PROMPTS = [
  'Use Browser to inspect the checkout flow and report any broken UI states.',
  'Open <url> with Browser, interact with the page, and summarize what changed after each step.',
];

function getBrowserUseCacheKey(projectId?: string | null): string {
  return projectId ? `browser-use:project:${projectId}` : 'browser-use:global';
}

function getFreshCacheEntry(cacheKey: string): BrowserUsePanelCacheEntry | null {
  const entry = browserUsePanelCache.get(cacheKey);
  if (!entry || Date.now() - entry.updatedAt > BROWSER_USE_CACHE_TTL_MS) {
    return null;
  }
  return entry;
}

export default function BrowserUsePanel({ isVisible, projectId, onShowSettings }: BrowserUsePanelProps) {
  const cacheKey = getBrowserUseCacheKey(projectId);
  const initialCacheEntry = getFreshCacheEntry(cacheKey);
  const [status, setStatus] = useState<BrowserUseStatus | null>(() => initialCacheEntry?.status ?? null);
  const [sessions, setSessions] = useState<BrowserUseSession[]>(() => initialCacheEntry?.sessions ?? []);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => (
    initialCacheEntry?.selectedSessionId || initialCacheEntry?.sessions[0]?.id || null
  ));
  const [hasLoadedOnce, setHasLoadedOnce] = useState(Boolean(initialCacheEntry));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeLoadIdRef = useRef(0);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const activeSessions = sessions.filter((session) => session.status === 'ready');
  const isInitialLoading = isRefreshing && !hasLoadedOnce && sessions.length === 0;
  const isBackgroundRefreshing = isRefreshing && !isInitialLoading;
  const needsBrowserBinaries = Boolean(status?.enabled && !status.available);
  const runtimeLabel = isInitialLoading
    ? 'Loading'
    : !status?.enabled
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

  const refresh = useCallback(async () => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;
    setIsRefreshing(true);
    try {
      let nextData: Awaited<ReturnType<typeof fetchBrowserPanelData>>;
      try {
        nextData = await fetchBrowserPanelData();
      } catch (error) {
        if (loadId !== activeLoadIdRef.current) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
        nextData = await fetchBrowserPanelData();
      }
      if (activeLoadIdRef.current !== loadId) {
        return;
      }
      const nextSessions = nextData.sessions;
      setStatus(nextData.status);
      setSessions(nextSessions);
      setHasLoadedOnce(true);
      let nextSelectedSessionId: string | null = null;
      setSelectedSessionId((current) => {
        nextSelectedSessionId = current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id || null;
        return nextSelectedSessionId;
      });
      browserUsePanelCache.set(cacheKey, {
        status: nextData.status,
        sessions: nextSessions,
        selectedSessionId: nextSelectedSessionId,
        updatedAt: Date.now(),
      });
      setError(null);
    } catch (err) {
      if (activeLoadIdRef.current !== loadId) {
        return;
      }
      setHasLoadedOnce(true);
      setError(err instanceof Error ? err.message : 'Failed to load Browser');
    } finally {
      if (activeLoadIdRef.current === loadId) {
        setIsRefreshing(false);
      }
    }
  }, [cacheKey]);

  useEffect(() => {
    const cachedEntry = browserUsePanelCache.get(cacheKey);
    if (!cachedEntry) return;
    browserUsePanelCache.set(cacheKey, {
      ...cachedEntry,
      selectedSessionId,
    });
  }, [cacheKey, selectedSessionId]);

  useEffect(() => {
    const cachedEntry = getFreshCacheEntry(cacheKey);
    setStatus(cachedEntry?.status ?? null);
    setSessions(cachedEntry?.sessions ?? []);
    setSelectedSessionId(cachedEntry?.selectedSessionId || cachedEntry?.sessions[0]?.id || null);
    setHasLoadedOnce(Boolean(cachedEntry));
    setError(null);
    activeLoadIdRef.current += 1;
  }, [cacheKey]);

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
      setError(err instanceof Error ? err.message : 'Browser action failed');
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

  const renderSessionItem = (session: BrowserUseSession) => {
    const isSelected = selectedSession?.id === session.id;
    return (
      <button
        key={session.id}
        type="button"
        onClick={() => setSelectedSessionId(session.id)}
        className={cn(
          'group w-full rounded-md border px-3 py-2.5 text-left transition-colors',
          isSelected
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border/60 bg-card/30 text-muted-foreground hover:bg-muted/50',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStatusDot(session.status))} />
              <div className="truncate text-sm font-medium">{session.title || getDomain(session.url)}</div>
            </div>
            <div className="mt-1 truncate pl-3.5 text-xs text-muted-foreground">{getDomain(session.url)}</div>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-background text-[10px] text-muted-foreground">
            {session.status}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span>{formatRelativeTime(session.updatedAt)}</span>
          <span className="truncate">- {formatAction(session.lastAction)}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 pl-3.5 text-[10px] text-muted-foreground">
          <span className="rounded border border-border/70 bg-background/70 px-1.5 py-0.5">{getEngineLabel(session.backend)}</span>
          <span className="rounded border border-border/70 bg-background/70 px-1.5 py-0.5">{session.profileName || 'Temporary'}</span>
        </div>
      </button>
    );
  };

  const renderEmptyState = () => (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-md border border-border bg-card/40 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <MonitorPlay className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {status?.enabled ? 'No browser sessions yet' : 'Browser is disabled'}
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {status?.enabled
                ? 'When an agent opens a browser, you can watch the latest screenshot, take control in a new tab, or end the running session.'
                : 'Enable Browser to let agents open websites, test flows, capture screenshots, and debug UI from a real page.'}
            </p>
            <a
              href={BROWSER_USE_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Read the Browser guide
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {needsBrowserBinaries && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium text-foreground">Runtime setup required</div>
            <p className="mt-1 text-sm text-muted-foreground">{status?.message}</p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
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

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((prompt) => (
            <div key={prompt} className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                Prompt
              </div>
              <p className="text-sm leading-6 text-foreground">{prompt}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderLoadingState = () => (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading browser sessions...
      </div>
    </div>
  );

  const renderBrowserSurface = (fullscreen = false) => (
    <div className={cn('flex flex-1 items-center justify-center bg-neutral-950', fullscreen ? 'min-h-[80vh]' : 'min-h-[420px]')}>
      {selectedSession?.screenshotDataUrl ? (
        <div className="group relative inline-block max-h-full">
          <img
            src={selectedSession.screenshotDataUrl}
            alt="Browser session screenshot"
            className={fullscreen ? 'block max-h-[80vh] w-auto max-w-full object-contain' : 'block max-h-[72vh] w-auto max-w-full object-contain'}
          />
          {cursorStyle && (
            <div
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-primary/80 shadow-[0_0_0_6px_hsl(var(--primary)/0.18)]"
              style={cursorStyle}
            >
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            </div>
          )}
          {selectedSession?.viewerEmbedUrl && selectedSession.status === 'ready' && (
            <button
              type="button"
              onClick={() => window.open(selectedSession.viewerUrl || selectedSession.viewerEmbedUrl || '', '_blank', 'noopener,noreferrer')}
              className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition focus-visible:bg-black/30 focus-visible:opacity-100 focus-visible:outline-none group-hover:bg-black/30 group-hover:opacity-100"
            >
              <span className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/80 px-3 py-2 text-sm font-medium text-white shadow-lg">
                <MousePointer2 className="h-4 w-4" />
                Take control
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="px-6 text-center">
          <MonitorPlay className="mx-auto h-9 w-9 text-neutral-500" />
          <div className="mt-3 text-sm font-medium text-neutral-100">{selectedSession?.message || 'Waiting for screenshot'}</div>
          <p className="mt-1 text-xs text-neutral-400">The next agent browser snapshot will render here.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Browser</h3>
            <Badge variant="outline" className={cn('text-[10px]', getRuntimeTone(status, isInstalling))}>
              {runtimeLabel}
            </Badge>
            <Badge variant="outline" className="border-border bg-background text-[10px] text-muted-foreground">
              {getEngineLabel(status?.backend)}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Watch and manage browser sessions agents use to test real websites.</p>
          {isBackgroundRefreshing && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Refreshing sessions...
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => window.open(BROWSER_USE_GUIDE_URL, '_blank', 'noopener,noreferrer')}
            title="Open Browser guide"
            aria-label="Open Browser guide"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          {onShowSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onShowSettings('browser')}
              title="Open Browser settings"
              aria-label="Open Browser settings"
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
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
                className={cn(
                  'flex min-w-[180px] items-center gap-2 rounded-md border px-2.5 py-2 text-left',
                  selectedSession?.id === session.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-background',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStatusDot(session.status))} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {session.title || getDomain(session.url)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="min-w-0 truncate">
              {activeSessions.length} active
              <span className="px-1.5">/</span>
              {sessions.length} total
            </div>
            <div className="min-w-0 truncate">
              Updated {formatRelativeTime(selectedSession?.updatedAt || null)}
            </div>
          </div>

          {sessions.length === 0 ? (
            isInitialLoading ? renderLoadingState() : renderEmptyState()
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
              <div className="mx-auto flex min-h-[500px] max-w-7xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Badge variant="outline" className={selectedSession ? cn('text-[10px]', getStatusTone(selectedSession.status)) : 'text-[10px]'}>
                    {selectedSession?.status || 'empty'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {selectedSession?.title || getDomain(selectedSession?.url || null)}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{selectedSession?.url || 'No page loaded'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      <span className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5">{getEngineLabel(selectedSession?.backend || status?.backend)}</span>
                      <span className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5">Profile: {selectedSession?.profileName || 'Temporary'}</span>
                      <span className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5">Updated {formatRelativeTime(selectedSession?.updatedAt || null)}</span>
                    </div>
                  </div>
                  <div className="hidden text-xs text-muted-foreground md:block">
                    {formatAction(selectedSession?.lastAction || null)}
                  </div>
                  {selectedSession?.viewerUrl && selectedSession.status === 'ready' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => window.open(selectedSession.viewerUrl || '', '_blank', 'noopener,noreferrer')}
                      title="Open live browser control in a new tab"
                      aria-label="Open live browser control in a new tab"
                    >
                      <MousePointer2 className="h-4 w-4" />
                      Take control
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setIsFullscreen(true)} disabled={!selectedSession?.screenshotDataUrl} title="Full screen" aria-label="Full screen">
                    <Expand className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'} title="End session" aria-label="End session">
                    <Square className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={deleteSession} disabled={isBusy || !selectedSession} title="Delete session" aria-label="Delete session">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {renderBrowserSurface()}
              </div>
            </div>
          )}
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border/60 bg-background lg:flex">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">Sessions</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{sessions.length} total</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{activeSessions.length} active</Badge>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sessions.length > 0 ? (
              <div className="space-y-2">{sessions.map(renderSessionItem)}</div>
            ) : isInitialLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading sessions...
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                No agent browser sessions.
              </div>
            )}
          </div>

          <div className="border-t border-border/60 p-3">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                Selected
              </div>
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>Status</span>
                  <span className="font-medium text-foreground">{selectedSession?.status || 'None'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Last action</span>
                  <span className="truncate font-medium text-foreground">{formatAction(selectedSession?.lastAction || null)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Profile</span>
                  <span className="truncate font-medium text-foreground">{selectedSession?.profileName || 'Temporary'}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
                  <Square className="h-4 w-4" />
                  End
                </Button>
                <Button variant="outline" size="sm" onClick={deleteSession} disabled={isBusy || !selectedSession}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </aside>
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
