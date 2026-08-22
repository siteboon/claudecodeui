import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Clock3,
  Download,
  Expand,
  ExternalLink,
  Loader2,
  MonitorPlay,
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
  onShowSettings?: (tab?: SettingsMainTab) => void;
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

async function readJson<T>(response: Response, t: TranslateFn): Promise<T> {
  // Empty or malformed bodies reject before the status check below; surface
  // the localized request failure instead of a raw parser error.
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(t('browserUse.requestFailed', { status: response.status }));
  }
  // A non-object body (JSON null, arrays, primitives) must also fall back
  // instead of raising a TypeError on the field access below.
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(t('browserUse.requestFailed', { status: response.status }));
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || t('browserUse.requestFailed', { status: response.status }));
  }
  return data as T;
}

async function readJsonWithFallback<T>(response: Response, fallbackError: string): Promise<T> {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackError);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(fallbackError);
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || fallbackError);
  }
  return data as T;
}

function formatRelativeTime(value: string | null, t: TranslateFn): string {
  if (!value) return t('browserUse.never');

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return t('browserUse.unknown');

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 10) return t('browserUse.justNow');
  if (elapsedSeconds < 60) return t('browserUse.secondsAgo', { n: elapsedSeconds });
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return t('browserUse.minutesAgo', { n: elapsedMinutes });
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return t('browserUse.hoursAgo', { n: elapsedHours });
  return t('browserUse.daysAgo', { n: Math.round(elapsedHours / 24) });
}

function getDomain(url: string | null, t: TranslateFn): string {
  if (!url) return t('browserUse.noPageLoaded');

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatAction(action: string | null, t: TranslateFn): string {
  if (!action) return t('browserUse.waitingAction');
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

function getStatusLabel(status: BrowserUseSession['status'] | undefined, t: TranslateFn): string {
  if (!status) return t('browserUse.statusEmpty');
  if (status === 'ready') return t('browserUse.statusReadySession');
  if (status === 'stopped') return t('browserUse.statusStoppedSession');
  if (status === 'unavailable') return t('browserUse.statusUnavailableSession');
  return status;
}

function getStatusDot(status: BrowserUseSession['status']): string {
  if (status === 'ready') return 'bg-primary';
  if (status === 'stopped') return 'bg-muted-foreground/50';
  return 'bg-border';
}

const PROMPT_KEYS = ['browserUse.prompt1', 'browserUse.prompt2'];

export default function BrowserUsePanel({ isVisible, onShowSettings }: BrowserUsePanelProps) {
  const { t } = useTranslation('settings');
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

  const activeSessions = sessions.filter((session) => session.status === 'ready');
  const needsBrowserBinaries = Boolean(status?.enabled && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = !status?.enabled
    ? t('browserUse.runtimeDisabled')
    : status.available
      ? t('browserUse.runtimeReady')
      : status.installInProgress || isInstalling
        ? t('browserUse.runtimeInstalling')
        : t('browserUse.runtimeSetupRequired');

  const cursorStyle = selectedSession?.cursor && selectedSession.viewport
    ? {
      left: `${(selectedSession.cursor.x / selectedSession.viewport.width) * 100}%`,
      top: `${(selectedSession.cursor.y / selectedSession.viewport.height) * 100}%`,
    }
    : null;

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [statusResponse, sessionsResponse] = await Promise.all([
        authenticatedFetch('/api/browser-use/status'),
        authenticatedFetch('/api/browser-use/sessions'),
      ]);
      const statusData = await readJson<{ data: BrowserUseStatus }>(statusResponse, t);
      const sessionsData = await readJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse, t);
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
      setError(err instanceof Error ? err.message : t('browserUse.loadFailed'));
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

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
      setError(err instanceof Error ? err.message : t('browserUse.actionFailed'));
    } finally {
      setIsBusy(false);
    }
  }, [refresh, t]);

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}/stop`, { method: 'POST' });
    await readJsonWithFallback(response, t('browserUse.actionFailed'));
  });

  const deleteSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/browser-use/sessions/${selectedSession.id}`, { method: 'DELETE' });
    await readJsonWithFallback(response, t('browserUse.actionFailed'));
    setIsFullscreen(false);
  });

  const installBrowserBinaries = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await authenticatedFetch('/api/browser-use/runtime/install', { method: 'POST' });
      await readJsonWithFallback(response, t('browserUse.actionFailed'));
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
              <div className="truncate text-sm font-medium">{session.title || getDomain(session.url, t)}</div>
            </div>
            <div className="mt-1 truncate pl-3.5 text-xs text-muted-foreground">{getDomain(session.url, t)}</div>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-background text-[10px] text-muted-foreground">
            {getStatusLabel(session.status, t)}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span>{formatRelativeTime(session.updatedAt, t)}</span>
          <span className="truncate">- {formatAction(session.lastAction, t)}</span>
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
              {status?.enabled ? t('browserUse.emptyTitleEnabled') : t('browserUse.emptyTitleDisabled')}
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {status?.enabled
                ? t('browserUse.emptyDescEnabled')
                : t('browserUse.emptyDescDisabled')}
            </p>
          </div>
        </div>

        {needsBrowserBinaries && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium text-foreground">{t('browserUse.runtimeSetupTitle')}</div>
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
              {isInstalling || status?.installInProgress ? t('browserUse.installing') : t('browserUse.installRuntime')}
            </Button>
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {PROMPT_KEYS.map((promptKey) => (
            <div key={promptKey} className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t('browserUse.promptLabel')}
              </div>
              <p className="text-sm leading-6 text-foreground">{t(promptKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderBrowserSurface = (fullscreen = false) => (
    <div className={cn('flex flex-1 items-center justify-center bg-neutral-950', fullscreen ? 'min-h-[80vh]' : 'min-h-[420px]')}>
      {selectedSession?.screenshotDataUrl ? (
        <div className="relative inline-block max-h-full">
          <img
            src={selectedSession.screenshotDataUrl}
            alt={t('browserUse.screenshotAlt')}
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
        </div>
      ) : (
        <div className="px-6 text-center">
          <MonitorPlay className="mx-auto h-9 w-9 text-neutral-500" />
          <div className="mt-3 text-sm font-medium text-neutral-100">{selectedSession?.message || t('browserUse.waitingScreenshot')}</div>
          <p className="mt-1 text-xs text-neutral-400">{t('browserUse.waitingScreenshotHint')}</p>
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
            <h3 className="text-sm font-semibold text-foreground">{t('browserUse.title')}</h3>
            <Badge variant="outline" className={cn('text-[10px]', getRuntimeTone(status, isInstalling))}>
              {runtimeLabel}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('browserUse.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onShowSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onShowSettings('browser')}
              title={t('browserUse.openSettings')}
              aria-label={t('browserUse.openSettings')}
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
            title={t('browserUse.refreshSessions')}
            aria-label={t('browserUse.refreshSessions')}
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
                  {session.title || getDomain(session.url, t)}
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
              {t('browserUse.activeCount', { n: activeSessions.length })}
              <span className="px-1.5">/</span>
              {t('browserUse.totalCount', { n: sessions.length })}
            </div>
            <div className="min-w-0 truncate">
              {t('browserUse.updated', { time: formatRelativeTime(selectedSession?.updatedAt || null, t) })}
            </div>
          </div>

          {sessions.length === 0 ? (
            renderEmptyState()
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
              <div className="mx-auto flex min-h-[500px] max-w-7xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Badge variant="outline" className={selectedSession ? cn('text-[10px]', getStatusTone(selectedSession.status)) : 'text-[10px]'}>
                    {getStatusLabel(selectedSession?.status, t)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {selectedSession?.title || getDomain(selectedSession?.url || null, t)}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{selectedSession?.url || t('browserUse.noPageLoaded')}</span>
                    </div>
                  </div>
                  <div className="hidden text-xs text-muted-foreground md:block">
                    {formatAction(selectedSession?.lastAction || null, t)}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setIsFullscreen(true)} disabled={!selectedSession?.screenshotDataUrl} title={t('browserUse.fullScreen')} aria-label={t('browserUse.fullScreen')}>
                    <Expand className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'} title={t('browserUse.stopSession')} aria-label={t('browserUse.stopSession')}>
                    <Square className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={deleteSession} disabled={isBusy || !selectedSession} title={t('browserUse.deleteSession')} aria-label={t('browserUse.deleteSession')}>
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
                <div className="text-sm font-semibold text-foreground">{t('browserUse.sessions')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t('browserUse.totalCount', { n: sessions.length })}</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{t('browserUse.activeCount', { n: activeSessions.length })}</Badge>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sessions.length > 0 ? (
              <div className="space-y-2">{sessions.map(renderSessionItem)}</div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                {t('browserUse.noSessions')}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 p-3">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t('browserUse.selected')}
              </div>
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>{t('browserUse.statusLabel')}</span>
                  <span className="font-medium text-foreground">{getStatusLabel(selectedSession?.status, t)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{t('browserUse.lastAction')}</span>
                  <span className="truncate font-medium text-foreground">{formatAction(selectedSession?.lastAction || null, t)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{t('browserUse.profileLabel')}</span>
                  <span className="truncate font-medium text-foreground">{selectedSession?.profileName || t('browserUse.temporaryProfile')}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
                  <Square className="h-4 w-4" />
                  {t('browserUse.stop')}
                </Button>
                <Button variant="outline" size="sm" onClick={deleteSession} disabled={isBusy || !selectedSession}>
                  <Trash2 className="h-4 w-4" />
                  {t('browserUse.delete')}
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
              <div className="min-w-0 truncate">{selectedSession.title || selectedSession.url || t('browserUse.sessionFallback')}</div>
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
                <X className="h-4 w-4" />
                {t('browserUse.close')}
              </Button>
            </div>
            {renderBrowserSurface(true)}
          </div>
        </div>
      )}
    </div>
  );
}
