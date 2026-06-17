import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Bot, Camera, Download, Expand, Loader2, MonitorCog, RefreshCw, ShieldCheck, Square, Trash2, X } from 'lucide-react';

import { Badge, Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';

type ComputerUseStatus = {
  enabled: boolean;
  runtime: 'cloud' | 'local';
  available: boolean;
  requiresDesktopBridge: boolean;
  nutInstalled: boolean;
  screenshotInstalled: boolean;
  installInProgress: boolean;
  sessionCount: number;
  agentToolsEnabled: boolean;
  mcpRecommended: boolean;
  message: string;
};

type ComputerUseSession = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  agentAccessEnabled: boolean;
  createdBy: 'user' | 'agent';
  displaySize: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent' | 'user';
  } | null;
};

type ComputerUsePanelProps = {
  isVisible: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function ComputerUsePanel({ isVisible }: ComputerUsePanelProps) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [sessions, setSessions] = useState<ComputerUseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const refresh = useCallback(async () => {
    const [statusResponse, sessionsResponse] = await Promise.all([
      authenticatedFetch('/api/computer-use/status'),
      authenticatedFetch('/api/computer-use/sessions'),
    ]);
    const statusData = await readJson<{ data: ComputerUseStatus }>(statusResponse);
    const sessionsData = await readJson<{ data: { sessions: ComputerUseSession[] } }>(sessionsResponse);
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
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Computer Use'));
  }, [isVisible, refresh]);

  // Poll while an active session exists so agent-driven changes show up live.
  useEffect(() => {
    if (!isVisible || !selectedSession || selectedSession.status !== 'ready') return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isVisible, selectedSession, refresh]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Computer Use action failed');
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const createSession = () => runAction(async () => {
    const response = await authenticatedFetch('/api/computer-use/sessions', { method: 'POST' });
    const data = await readJson<{ data: { session: ComputerUseSession } }>(response);
    setSelectedSessionId(data.data.session.id);
  });

  const captureScreenshot = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/screenshot`, { method: 'POST' });
    await readJson(response);
  });

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/stop`, { method: 'POST' });
    await readJson(response);
  });

  const deleteSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}`, { method: 'DELETE' });
    await readJson(response);
    setIsFullscreen(false);
  });

  const grantControl = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/consent/grant`, { method: 'POST' });
    await readJson(response);
  });

  const revokeControl = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/consent/revoke`, { method: 'POST' });
    await readJson(response);
  });

  const installRuntime = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await authenticatedFetch('/api/computer-use/runtime/install', { method: 'POST' });
      await readJson(response);
    } finally {
      setIsInstalling(false);
    }
  });

  const clickViewer = useCallback((event: MouseEvent<HTMLImageElement>) => {
    if (!selectedSession || selectedSession.status !== 'ready' || !selectedSession.displaySize) {
      return;
    }
    viewerRef.current?.focus();

    const bounds = event.currentTarget.getBoundingClientRect();
    const scaleX = selectedSession.displaySize.width / bounds.width;
    const scaleY = selectedSession.displaySize.height / bounds.height;
    const x = Math.round((event.clientX - bounds.left) * scaleX);
    const y = Math.round((event.clientY - bounds.top) * scaleY);

    void runAction(async () => {
      const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/click`, {
        method: 'POST',
        body: JSON.stringify({ x, y, double: event.detail === 2 }),
      });
      await readJson(response);
    });
  }, [runAction, selectedSession]);

  const keyForEvent = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') return 'Space';
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey && event.key.length > 1) parts.push('shift');
    if (event.metaKey) parts.push('meta');
    parts.push(event.key);
    return parts.join('+');
  }, []);

  const pressViewerKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectedSession || selectedSession.status !== 'ready') {
      return;
    }

    const ignoredKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
    if (ignoredKeys.has(event.key)) {
      return;
    }

    event.preventDefault();
    const key = keyForEvent(event);
    void runAction(async () => {
      const response = await authenticatedFetch(`/api/computer-use/sessions/${selectedSession.id}/press-key`, {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      await readJson(response);
    });
  }, [keyForEvent, runAction, selectedSession]);

  const needsRuntime = Boolean(status?.enabled && status.runtime === 'local' && (!status.nutInstalled || !status.screenshotInstalled));
  const isCloud = status?.runtime === 'cloud';

  const cursorStyle = selectedSession?.cursor && selectedSession.displaySize
    ? {
      left: `${(selectedSession.cursor.x / selectedSession.displaySize.width) * 100}%`,
      top: `${(selectedSession.cursor.y / selectedSession.displaySize.height) * 100}%`,
    }
    : null;

  const renderSurface = (fullscreen = false) => (
    <div
      ref={viewerRef}
      tabIndex={selectedSession?.status === 'ready' ? 0 : -1}
      onKeyDown={pressViewerKey}
      className={`flex min-h-[360px] flex-1 items-center justify-center bg-neutral-950 outline-none ${fullscreen ? 'min-h-[80vh]' : ''}`}
    >
      {selectedSession?.screenshotDataUrl ? (
        <div className="relative inline-block max-h-full">
          <img
            src={selectedSession.screenshotDataUrl}
            alt="Desktop screenshot"
            className={fullscreen ? 'block max-h-[80vh] w-auto max-w-full object-contain' : 'block max-h-[70vh] w-auto max-w-full object-contain'}
            onClick={clickViewer}
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
          <MonitorCog className="mx-auto h-10 w-10 text-neutral-500" />
          <div className="mt-3 text-sm font-medium text-neutral-100">
            {selectedSession?.message || 'Start a Computer Use session to capture your desktop.'}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            {isCloud
              ? 'Cloud Computer Use requires a linked local CloudCLI Desktop Agent.'
              : 'Install the desktop control runtime from this panel or enable Computer Use from Settings.'}
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
            <MonitorCog className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Computer Use</h3>
            {status && <Badge variant="outline" className="text-[11px]">{status.runtime}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Capture your desktop and let agents drive the mouse and keyboard — only while you grant control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isBusy}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={createSession} disabled={isBusy || !status?.available}>
            <MonitorCog className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-border/60 p-3 lg:border-b-0 lg:border-r">
          {needsRuntime && (
            <div className="rounded-lg border border-border/70 bg-card/40 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Desktop runtime required</div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {status?.message || 'Install the desktop control runtime to enable Computer Use.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-md border border-border px-2 py-1">
                  Control lib: {status?.nutInstalled ? 'installed' : 'missing'}
                </span>
                <span className="rounded-md border border-border px-2 py-1">
                  Screen capture: {status?.screenshotInstalled ? 'installed' : 'missing'}
                </span>
              </div>
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
                {isInstalling || status?.installInProgress ? 'Installing…' : 'Install Runtime'}
              </Button>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Safety
              </div>
              <p className="mt-1.5">
                Agents can act on a session only while you have granted control. Use
                <span className="font-medium text-foreground"> Grant Control </span>
                to allow agent actions, and
                <span className="font-medium text-foreground"> Stop </span>
                to revoke instantly.
              </p>
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
                  <span className="truncate font-medium">
                    {session.createdBy === 'agent' ? 'Agent session' : 'Desktop session'}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{session.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {session.agentAccessEnabled ? (
                    <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                      control granted
                    </span>
                  ) : (
                    <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                      awaiting consent
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate text-xs">{session.lastAction || session.message || session.id}</div>
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                No Computer Use sessions yet.
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <Button variant="outline" size="sm" onClick={captureScreenshot} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
              <Camera className="h-4 w-4" />
              Screenshot
            </Button>
            {selectedSession?.agentAccessEnabled ? (
              <Button variant="outline" size="sm" onClick={revokeControl} disabled={isBusy || !selectedSession}>
                <X className="h-4 w-4" />
                Revoke Control
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={grantControl}
                disabled={isBusy || !selectedSession || selectedSession.status !== 'ready' || !status?.agentToolsEnabled}
              >
                <Bot className="h-4 w-4" />
                Grant Control
              </Button>
            )}
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

          {error && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
            <div className="mx-auto flex min-h-[420px] max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <MonitorCog className="h-3.5 w-3.5" />
                <span className="truncate">
                  {selectedSession?.displaySize
                    ? `${selectedSession.displaySize.width}×${selectedSession.displaySize.height}`
                    : 'No screen captured'}
                </span>
                {selectedSession?.agentAccessEnabled && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-500/30 px-2 py-0.5 text-emerald-600 dark:text-emerald-300">
                    <Bot className="h-3.5 w-3.5" />
                    Agent control active
                  </span>
                )}
              </div>
              {renderSurface()}
            </div>
            <p className="mx-auto mt-2 max-w-6xl text-center text-xs text-muted-foreground">
              Click the screenshot to click the real desktop. Focus the view and type to send keystrokes.
            </p>
          </div>
        </main>
      </div>
      {isFullscreen && selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/90 p-6">
          <div className="flex h-full flex-col rounded-lg border border-white/10 bg-black">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-white/80">
              <div className="min-w-0 truncate">Desktop session</div>
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>
            {renderSurface(true)}
          </div>
        </div>
      )}
    </div>
  );
}
