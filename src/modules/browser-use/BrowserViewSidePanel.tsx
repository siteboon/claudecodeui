import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  MousePointerClick,
  Square,
  X,
} from 'lucide-react';

import { cn } from '@/shared/utils';
import { Badge, Button } from '@/shared/ui';
import { api, readApiJson } from '@/shared/api';
import {
  computeContentRect,
  mapClientPointToFrame,
  useBrowserViewStream,
} from '@/modules/browser-use/hooks/useBrowserViewStream';
import type { BrowserViewStreamStatus } from '@/modules/browser-use/hooks/useBrowserViewStream';

/** Compact session summary used by the side panel's selector. */
type BrowserViewSessionOption = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
};

type BrowserViewSidePanelProps = {
  /** Hides the panel; the workspace keeps it mounted only while open and not mobile. */
  onClose: () => void;
};

type BrowserViewStream = ReturnType<typeof useBrowserViewStream>;

const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 720;
const SESSIONS_POLL_MS = 5_000;
const DOUBLE_CLICK_WINDOW_MS = 450;

const STATUS_LABEL_KEYS: Record<BrowserViewStreamStatus, string> = {
  idle: 'browserView.statusIdle',
  connecting: 'browserView.statusConnecting',
  live: 'browserView.statusLive',
  paused: 'browserView.statusPaused',
  reconnecting: 'browserView.statusReconnecting',
  stopped: 'browserView.statusStopped',
  error: 'browserView.statusError',
};

function statusBadgeClass(status: BrowserViewStreamStatus): string {
  if (status === 'live') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'connecting' || status === 'reconnecting') return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (status === 'error') return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-border bg-muted text-muted-foreground';
}

/** Maps a DOM mouse button number onto the wire protocol's button names. */
function wireButton(button: number): 'left' | 'right' | 'middle' {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}

function domModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): string[] {
  const modifiers: string[] = [];
  if (event.altKey) modifiers.push('alt');
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey) modifiers.push('meta');
  if (event.shiftKey) modifiers.push('shift');
  return modifiers;
}

type BrowserViewSurfaceProps = {
  view: BrowserViewStream;
  isInteracting: boolean;
  onExitInteraction: () => void;
};

/**
 * Module-private viewer surface: letterboxes the latest frame inside its own
 * measured container and, while interacting, forwards pointer, wheel, key, and
 * paste input using live geometry from getBoundingClientRect at event time.
 */
function BrowserViewSurface({ view, isInteracting, onExitInteraction }: BrowserViewSurfaceProps) {
  const { t } = useTranslation('settings');
  // Measured with a ResizeObserver because the container's flex size depends
  // on the workspace layout and the fullscreen overlay.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastClickAtRef = useRef(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isInteracting) {
      containerRef.current?.focus();
    }
  }, [isInteracting]);

  // Keeps the latest stream handle reachable from the non-passive wheel
  // listener without re-attaching it on every render.
  const viewRef = useRef(view);
  viewRef.current = view;

  // React attaches onWheel passively, so preventDefault needs a native
  // non-passive listener while takeover mode is active.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !isInteracting) {
      return;
    }
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const currentView = viewRef.current;
      const box = element.getBoundingClientRect();
      const rect = computeContentRect(box.width, box.height, currentView.frameSize?.width ?? 0, currentView.frameSize?.height ?? 0);
      const point = mapClientPointToFrame(rect, event.clientX, event.clientY, { left: box.left, top: box.top });
      if (!point) {
        return;
      }
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(1, box.height)
          : 1;
      currentView.sendInput({
        kind: 'wheel',
        u: point.u,
        v: point.v,
        deltaX: event.deltaX * multiplier,
        deltaY: event.deltaY * multiplier,
      });
    };
    element.addEventListener('wheel', onWheelNative, { passive: false });
    return () => element.removeEventListener('wheel', onWheelNative);
  }, [isInteracting]);

  const contentRect = computeContentRect(
    containerSize.width,
    containerSize.height,
    view.frameSize?.width ?? 0,
    view.frameSize?.height ?? 0,
  );

  const toFramePoint = (element: HTMLElement, clientX: number, clientY: number) => {
    const box = element.getBoundingClientRect();
    return mapClientPointToFrame(
      computeContentRect(box.width, box.height, view.frameSize?.width ?? 0, view.frameSize?.height ?? 0),
      clientX,
      clientY,
      { left: box.left, top: box.top },
    );
  };

  const sendMouse = (event: React.MouseEvent, action: 'move' | 'down' | 'up') => {
    const point = toFramePoint(event.currentTarget as HTMLElement, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    if (action === 'up') {
      const now = Date.now();
      const clickCount = now - lastClickAtRef.current < DOUBLE_CLICK_WINDOW_MS ? 2 : 1;
      lastClickAtRef.current = now;
      view.sendInput({ kind: 'mouse', action, u: point.u, v: point.v, button: wireButton(event.button), clickCount, modifiers: domModifiers(event) });
      return;
    }
    view.sendInput({ kind: 'mouse', action, u: point.u, v: point.v, button: wireButton(event.button), modifiers: domModifiers(event) });
  };

  const agentCursor = view.sessionMeta?.cursor && view.sessionMeta.viewport
    ? {
      left: `${(view.sessionMeta.cursor.x / view.sessionMeta.viewport.width) * 100}%`,
      top: `${(view.sessionMeta.cursor.y / view.sessionMeta.viewport.height) * 100}%`,
    }
    : null;

  return (
    <div
      ref={containerRef}
      tabIndex={isInteracting ? 0 : undefined}
      className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      onMouseMove={(event) => {
        if (isInteracting) sendMouse(event, 'move');
      }}
      onMouseDown={(event) => {
        if (!isInteracting) return;
        event.preventDefault();
        sendMouse(event, 'down');
      }}
      onMouseUp={(event) => {
        if (isInteracting) sendMouse(event, 'up');
      }}
      onKeyDown={(event) => {
        if (!isInteracting) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onExitInteraction();
          return;
        }
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
        view.sendInput({
          kind: 'key',
          action: 'down',
          key: event.key,
          code: event.code,
          text: printable ? event.key : undefined,
          repeat: event.repeat,
          location: event.location,
          modifiers: domModifiers(event),
        });
      }}
      onKeyUp={(event) => {
        if (!isInteracting || event.key === 'Escape') return;
        event.preventDefault();
        view.sendInput({
          kind: 'key',
          action: 'up',
          key: event.key,
          code: event.code,
          location: event.location,
          modifiers: domModifiers(event),
        });
      }}
      onPaste={(event) => {
        if (!isInteracting) return;
        const text = event.clipboardData.getData('text');
        if (text) {
          event.preventDefault();
          view.sendInput({ kind: 'text', text: text.slice(0, 2_000) });
        }
      }}
      onContextMenu={(event) => {
        if (isInteracting) {
          event.preventDefault();
        }
      }}
    >
      {view.frameUrl ? (
        <img
          src={view.frameUrl}
          alt={t('browserView.frameAlt')}
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{
            left: contentRect.left,
            top: contentRect.top,
            width: contentRect.width,
            height: contentRect.height,
          }}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <MonitorPlay className="h-8 w-8 text-neutral-500" />
          <div className="text-sm text-neutral-300">
            {view.status === 'connecting' || view.status === 'reconnecting' || view.status === 'live'
              ? t('browserView.waitingFirstFrame')
              : t('browserView.pausedHint')}
          </div>
          {(view.status === 'connecting' || view.status === 'reconnecting') && (
            <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
          )}
        </div>
      )}

      {agentCursor && view.frameUrl && (
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/90 bg-primary/40"
          style={{ left: agentCursor.left, top: agentCursor.top }}
        />
      )}

      {!isInteracting && view.status === 'live' && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-neutral-200">
          {t('browserView.observeHint')}
        </div>
      )}
    </div>
  );
}

/** Used by the project-workspace module to render the live browser viewer beside chat, with optional input takeover. */
export default function BrowserViewSidePanel({ onClose }: BrowserViewSidePanelProps) {
  const { t } = useTranslation('settings');

  // Panel geometry; dragged width lives in component state because it is a
  // per-device visual preference, not app data.
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Input takeover is opt-in so scrolling or clicking the panel in observe
  // mode never reaches the agent's browser.
  const [isInteracting, setIsInteracting] = useState(false);

  const [sessions, setSessions] = useState<BrowserViewSessionOption[]>([]);
  // Manual selection persists while that session exists; otherwise the newest ready session wins.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId)
      ?? sessions.find((session) => session.status === 'ready')
      ?? sessions[0]
      ?? null,
    [sessions, selectedSessionId],
  );

  // The stream pauses when the document is hidden; the server also stops
  // delivering frames to invisible viewers, saving capture work.
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const handleVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const view = useBrowserViewStream({
    sessionId: selectedSession?.id ?? null,
    active: Boolean(selectedSession?.status === 'ready' && isDocumentVisible),
  });

  const refreshSessions = useCallback(async () => {
    try {
      const response = await api.browserUse.sessions();
      const data = await readApiJson<{ data: { sessions: BrowserViewSessionOption[] } }>(response);
      setSessions(data.data.sessions);
      setSelectedSessionId((current) => (
        current && data.data.sessions.some((session) => session.id === current)
          ? current
          : data.data.sessions.find((session) => session.status === 'ready')?.id ?? data.data.sessions[0]?.id ?? null
      ));
    } catch {
      // Polling errors surface through the stream status; the selector keeps its last snapshot.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const timer = window.setInterval(() => void refreshSessions(), SESSIONS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshSessions]);

  const stopBrowser = useCallback(async () => {
    if (!selectedSession) return;
    setIsStopping(true);
    try {
      const response = await api.browserUse.stopSession(selectedSession.id);
      await readApiJson(response);
      await refreshSessions();
    } catch {
      // Keep the current state; the next poll re-syncs the session list.
    } finally {
      setIsStopping(false);
    }
  }, [selectedSession, refreshSessions]);

  // Leaving interactive mode when the stream goes away avoids a dead input trap.
  useEffect(() => {
    if (view.status !== 'live') {
      setIsInteracting(false);
    }
  }, [view.status]);

  const handleResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + (startX - moveEvent.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelWidth]);

  const statusLabel = t(STATUS_LABEL_KEYS[view.status]);
  const canStop = selectedSession?.status === 'ready' && !isStopping;
  const interactTitle = isInteracting ? t('browserView.stopControlling') : t('browserView.takeControl');

  return (
    <>
      <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/60 bg-background"
        style={{ width: panelWidth }}
        data-testid="browser-view-side-panel"
      >
        <div
          onPointerDown={handleResizeStart}
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-primary/40"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('browserView.resizeHandle')}
        />

        <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
          <select
            value={selectedSession?.id ?? ''}
            onChange={(event) => setSelectedSessionId(event.target.value || null)}
            className="h-7 min-w-0 flex-1 truncate rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
            aria-label={t('browserView.sessionSelect')}
          >
            {sessions.length === 0 && <option value="">{t('browserView.noSessions')}</option>}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || session.url || session.id.slice(0, 8)}
              </option>
            ))}
          </select>

          <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusBadgeClass(view.status))}>
            {(view.status === 'connecting' || view.status === 'reconnecting') && (
              <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
            )}
            {statusLabel}
            {view.status === 'live' && view.fps > 0 ? ` ${view.fps}fps` : ''}
          </Badge>

          <Button
            variant={isInteracting ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            disabled={view.status !== 'live'}
            onClick={() => setIsInteracting((current) => !current)}
            title={interactTitle}
            aria-label={interactTitle}
            aria-pressed={isInteracting}
          >
            <MousePointerClick className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            disabled={!view.frameUrl}
            onClick={() => setIsFullscreen(true)}
            title={t('browserView.fullscreen')}
            aria-label={t('browserView.fullscreen')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
            disabled={!canStop}
            onClick={() => void stopBrowser()}
            title={t('browserView.stopBrowserHint')}
            aria-label={t('browserView.stopBrowser')}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={onClose}
            title={t('browserView.closePanel')}
            aria-label={t('browserView.closePanel')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {isInteracting && (
          <div className="border-b border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] leading-4 text-foreground">
            {t('browserView.controllingHint')}
          </div>
        )}

        {view.errorCode === 'unauthorized' && (
          <div className="border-b border-destructive/20 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive">
            {t('browserView.unauthorized')}
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <MonitorPlay className="h-8 w-8 text-muted-foreground/50" />
            <div className="text-sm font-medium text-foreground">{t('browserView.noSessions')}</div>
            <p className="text-xs text-muted-foreground">{t('browserView.noSessionsHint')}</p>
          </div>
        ) : (
          <BrowserViewSurface view={view} isInteracting={isInteracting} onExitInteraction={() => setIsInteracting(false)} />
        )}
      </aside>

      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm text-white/80">
              {view.sessionMeta?.title || view.sessionMeta?.url || t('browserView.title')}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant={isInteracting ? 'default' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                disabled={view.status !== 'live'}
                onClick={() => setIsInteracting((current) => !current)}
                title={interactTitle}
                aria-label={interactTitle}
              >
                <MousePointerClick className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setIsFullscreen(false)} title={t('browserView.exitFullscreen')} aria-label={t('browserView.exitFullscreen')}>
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <BrowserViewSurface view={view} isInteracting={isInteracting} onExitInteraction={() => setIsInteracting(false)} />
        </div>
      )}
    </>
  );
}
