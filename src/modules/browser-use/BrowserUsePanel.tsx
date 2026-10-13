import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, MouseEvent } from 'react';
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

import { cn } from '@/shared/utils';
import { Badge, Button, Input } from '@/shared/ui';
import { api, readApiJson, ApiRequestError } from '@/shared/api';
import type { SettingsMainTab } from '@/shared/types';
import { useBrowserUseStream } from '@/modules/browser-use/hooks/useBrowserUseStream';
import type { BrowserUseInput } from '@/modules/browser-use/hooks/useBrowserUseStream';

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

const BROWSER_USE_PANEL_ERROR_KEYS: Record<string, string> = {
  BROWSER_USE_STATUS_LOAD_FAILED: 'browserUse.loadFailed',
  BROWSER_USE_SESSIONS_LOAD_FAILED: 'browserUse.loadFailed',
  BROWSER_USE_SESSION_STOP_FAILED: 'browserUse.actionFailed',
  BROWSER_USE_SESSION_DELETE_FAILED: 'browserUse.actionFailed',
  BROWSER_USE_SESSION_INPUT_FAILED: 'browserUse.actionFailed',
  BROWSER_USE_RUNTIME_INSTALL_FAILED: 'browserUse.installFailed',
};

function localizeApiError(err: unknown, fallbackKey: string, t: TranslateFn): string {
  if (err instanceof ApiRequestError && err.code && BROWSER_USE_PANEL_ERROR_KEYS[err.code]) {
    return t(BROWSER_USE_PANEL_ERROR_KEYS[err.code]);
  }
  return t(fallbackKey);
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

/** Used by the project-workspace module to render the Browser tab's session list and live preview. */
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
        api.browserUse.status(),
        api.browserUse.sessions(),
      ]);
      const statusData = await readApiJson<{ data: BrowserUseStatus }>(statusResponse);
      const sessionsData = await readApiJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
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
      setError(localizeApiError(err, 'browserUse.loadFailed', t));
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
      setError(localizeApiError(err, 'browserUse.actionFailed', t));
    } finally {
      setIsBusy(false);
    }
  }, [refresh, t]);

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await api.browserUse.stopSession(selectedSession.id);
    await readApiJson(response);
  });

  const deleteSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await api.browserUse.deleteSession(selectedSession.id);
    await readApiJson(response);
    setIsFullscreen(false);
  });

  const [inputText, setInputText] = useState('');

  // The page's selection arrives from the server after a copy/cut; put it on the user's clipboard.
  const writeLocalClipboard = useCallback((text: string) => {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return;
    }
    // Plain-http pages have no async clipboard API; fall back to a temporary textarea.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }, []);

  const { frameUrl: liveFrameUrl, isLive, send: sendLiveInput } = useBrowserUseStream(
    selectedSession?.id ?? null,
    isVisible && selectedSession?.status === 'ready',
    writeLocalClipboard,
  );

  const sendInput = useCallback(async (input: BrowserUseInput) => {
    if (!selectedSession || selectedSession.status !== 'ready') return;
    if (sendLiveInput(input)) return;
    setError(null);
    try {
      const response = await api.browserUse.sendInput(selectedSession.id, input);
      const data = await readApiJson<{ data: { session: BrowserUseSession } }>(response);
      setSessions((current) => current.map((session) => (session.id === data.data.session.id ? data.data.session : session)));
    } catch (err) {
      setError(localizeApiError(err, 'browserUse.actionFailed', t));
    }
  }, [selectedSession, sendLiveInput, t]);

  // Wheel events must be non-passive to stop the panel itself from scrolling, which React's
  // onWheel cannot do; so listen on the document and act only while the pointer is over the surface.
  const hoveredSurfaceRef = useRef<HTMLElement | null>(null);
  const wheelStateRef = useRef({ isLive, viewport: selectedSession?.viewport ?? null, sendLiveInput });
  useEffect(() => {
    wheelStateRef.current = { isLive, viewport: selectedSession?.viewport ?? null, sendLiveInput };
  }, [isLive, selectedSession?.viewport, sendLiveInput]);

  useEffect(() => {
    let pending: { x: number; y: number; deltaX: number; deltaY: number } | null = null;
    let timer: number | null = null;

    const flush = () => {
      timer = null;
      if (pending) {
        wheelStateRef.current.sendLiveInput({ type: 'scroll', ...pending });
        pending = null;
      }
    };

    const onWheel = (event: WheelEvent) => {
      const surface = hoveredSurfaceRef.current;
      const { isLive: live, viewport } = wheelStateRef.current;
      if (!surface || !live || !viewport) return;
      const image = surface.querySelector('img');
      const rect = image?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;

      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      pending = {
        x: ((event.clientX - rect.left) / rect.width) * viewport.width,
        y: ((event.clientY - rect.top) / rect.height) * viewport.height,
        deltaX: (pending?.deltaX ?? 0) + event.deltaX * unit,
        deltaY: (pending?.deltaY ?? 0) + event.deltaY * unit,
      };
      if (timer === null) {
        timer = window.setTimeout(flush, 40);
      }
    };

    document.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('wheel', onWheel);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const toViewportPoint = (event: MouseEvent<HTMLImageElement>) => {
    const viewport = selectedSession?.viewport;
    if (!viewport) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * viewport.width,
      y: ((event.clientY - rect.top) / rect.height) * viewport.height,
    };
  };

  // `event.detail` is the browser's click count, so double and triple clicks select words and lines.
  const handleSurfaceClick = (event: MouseEvent<HTMLImageElement>) => {
    const point = toViewportPoint(event);
    if (!point) return;
    void sendInput({ type: 'click', ...point, clickCount: Math.min(Math.max(event.detail, 1), 3) });
  };

  const handleSurfaceContextMenu = (event: MouseEvent<HTMLImageElement>) => {
    event.preventDefault();
    const point = toViewportPoint(event);
    if (!point || !isLive) return;
    sendLiveInput({ type: 'click', ...point, button: 'right' });
  };

  const handleSurfacePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!isLive) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    // The server accepts up to 2000 characters per message.
    for (let index = 0; index < text.length; index += 2000) {
      sendLiveInput({ type: 'text', text: text.slice(index, index + 2000) });
    }
  };

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isLive || event.target !== event.currentTarget) return;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      void sendInput({ type: 'text', text: event.key });
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;

    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey ? event.key.toLowerCase() : '';
    // Paste is handled by the `paste` event, which carries the user's clipboard text.
    if (shortcut === 'v') return;
    event.preventDefault();
    // Copy/cut: ask the page for its selection first (messages are processed in order), then cut.
    if (shortcut === 'c' || shortcut === 'x') {
      sendLiveInput({ type: 'copy' });
      if (shortcut === 'c') return;
    }
    // Command (Mac) shortcuts map to Control, which is what the remote Linux Chromium expects.
    const modifiers = [(event.ctrlKey || event.metaKey) && 'Control', event.altKey && 'Alt'].filter(Boolean);
    void sendInput({ type: 'key', key: [...modifiers, event.key].join('+') });
  };

  const submitInputText = async () => {
    if (!inputText) return;
    const text = inputText;
    setInputText('');
    await sendInput({ type: 'text', text });
    await sendInput({ type: 'key', key: 'Enter' });
  };

  const installBrowserBinaries = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await api.browserUse.installRuntime();
      await readApiJson(response);
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

  const renderBrowserScreen = (fullscreen = false) => (
    <div className={cn('flex flex-1 items-center justify-center bg-neutral-950', fullscreen ? 'min-h-[80vh]' : 'min-h-[420px]')}>
      {selectedSession?.screenshotDataUrl ? (
        <div
          className="relative inline-block max-h-full outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          tabIndex={isLive ? 0 : -1}
          onKeyDown={handleSurfaceKeyDown}
          onPaste={handleSurfacePaste}
          onMouseEnter={(event) => { hoveredSurfaceRef.current = event.currentTarget; }}
          onMouseLeave={() => { hoveredSurfaceRef.current = null; }}
        >
          <img
            src={liveFrameUrl ?? selectedSession.screenshotDataUrl}
            alt={t('browserUse.screenshotAlt')}
            onClick={handleSurfaceClick}
            onContextMenu={handleSurfaceContextMenu}
            className={cn(
              fullscreen ? 'block max-h-[80vh] w-auto max-w-full object-contain' : 'block max-h-[72vh] w-auto max-w-full object-contain',
              selectedSession.status === 'ready' && 'cursor-pointer',
            )}
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

  const renderBrowserSurface = (fullscreen = false) => (
    <div className="flex flex-1 flex-col">
      {renderBrowserScreen(fullscreen)}
      {selectedSession?.status === 'ready' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-background px-3 py-2">
          <Input
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitInputText();
              }
            }}
            placeholder={t('browserUse.inputPlaceholder')}
            className="min-w-[200px] flex-1"
          />
          <Button variant="outline" size="sm" onClick={() => void submitInputText()} disabled={!inputText}>{t('browserUse.inputSend')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Backspace' })}>{t('browserUse.inputBackspace')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Tab' })}>{t('browserUse.inputTab')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Enter' })}>{t('browserUse.inputEnter')}</Button>
          <span className="w-full text-xs text-muted-foreground">{isLive ? t('browserUse.inputHintLive') : t('browserUse.inputHint')}</span>
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
