import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MousePointer2, Lock, Unlock, AlertTriangle } from 'lucide-react';

type Frame = {
  data: string; // base64 JPEG
  metadata?: {
    offsetTop?: number;
    pageScaleFactor?: number;
    deviceWidth?: number;
    deviceHeight?: number;
    scrollOffsetX?: number;
    scrollOffsetY?: number;
    timestamp?: number;
  };
};

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export type BrowserPaneProps = {
  variant?: 'panel' | 'modal';
  className?: string;
};

function buildWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = localStorage.getItem('auth-token');
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${host}/ws/chrome-view${qs}`;
}

function mapMouseButton(btn: number): string {
  switch (btn) {
    case 0: return 'left';
    case 1: return 'middle';
    case 2: return 'right';
    default: return 'none';
  }
}

function cdpModifiers(e: MouseEvent | KeyboardEvent): number {
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
}

export default function BrowserPane({ variant = 'panel', className = '' }: BrowserPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imgPoolRef = useRef<HTMLImageElement[]>([]);
  const [status, setStatus] = useState<ConnectionState>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [tabUrl, setTabUrl] = useState<string>('');
  const [tabTitle, setTabTitle] = useState<string>('');
  const [takeControl, setTakeControl] = useState<boolean>(false);
  const takeControlRef = useRef<boolean>(false);
  const frameSizeRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 });

  useEffect(() => {
    takeControlRef.current = takeControl;
  }, [takeControl]);

  const drawFrame = useCallback((frame: Frame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imgPoolRef.current.pop() || new Image();
    img.onload = () => {
      if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth;
      if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
      frameSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      ctx.drawImage(img, 0, 0);
      imgPoolRef.current.push(img);
    };
    img.onerror = () => {
      imgPoolRef.current.push(img);
    };
    img.src = `data:image/jpeg;base64,${frame.data}`;
  }, []);

  const sendInput = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('connecting');
    setErrorMsg('');
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!cancelled) setStatus('connected');
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      const type = msg.type as string | undefined;
      if (type === 'connected') {
        setTabUrl(String(msg.tabUrl || ''));
        setTabTitle(String(msg.tabTitle || ''));
      } else if (type === 'frame') {
        drawFrame({
          data: String(msg.data || ''),
          metadata: (msg as { metadata?: Frame['metadata'] }).metadata,
        });
      } else if (type === 'error') {
        setErrorMsg(String(msg.error || 'Unknown error'));
        setStatus('error');
      }
    };

    ws.onerror = () => {
      if (!cancelled) {
        setStatus('error');
        setErrorMsg('WebSocket connection failed.');
      }
    };

    ws.onclose = () => {
      if (!cancelled) setStatus('closed');
    };

    return () => {
      cancelled = true;
      try { ws.close(); } catch { /* no-op */ }
      wsRef.current = null;
    };
  }, [drawFrame]);

  const canvasToFrameCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { w, h } = frameSizeRef.current;
    const xInCanvas = ((clientX - rect.left) / rect.width) * w;
    const yInCanvas = ((clientY - rect.top) / rect.height) * h;
    return { x: Math.round(xInCanvas), y: Math.round(yInCanvas) };
  }, []);

  const handleMouseEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>, event: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => {
    if (!takeControlRef.current) return;
    const { x, y } = canvasToFrameCoords(e.clientX, e.clientY);
    sendInput({
      type: 'mouse',
      event,
      x,
      y,
      button: mapMouseButton(e.button),
      buttons: e.buttons,
      clickCount: event === 'mousePressed' ? (e.detail || 1) : 0,
      modifiers: cdpModifiers(e.nativeEvent),
    });
  }, [canvasToFrameCoords, sendInput]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!takeControlRef.current) return;
    e.preventDefault();
    const { x, y } = canvasToFrameCoords(e.clientX, e.clientY);
    sendInput({
      type: 'scroll',
      x,
      y,
      deltaX: -e.deltaX,
      deltaY: -e.deltaY,
      modifiers: cdpModifiers(e.nativeEvent),
    });
  }, [canvasToFrameCoords, sendInput]);

  useEffect(() => {
    if (!takeControl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!takeControlRef.current) return;
      // Don't intercept common app shortcuts.
      if (e.metaKey || e.ctrlKey) return;
      sendInput({
        type: 'key',
        event: 'keyDown',
        text: e.key.length === 1 ? e.key : '',
        key: e.key,
        code: e.code,
        modifiers: cdpModifiers(e),
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!takeControlRef.current) return;
      if (e.metaKey || e.ctrlKey) return;
      sendInput({
        type: 'key',
        event: 'keyUp',
        text: e.key.length === 1 ? e.key : '',
        key: e.key,
        code: e.code,
        modifiers: cdpModifiers(e),
      });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [takeControl, sendInput]);

  const rootHeight = variant === 'modal' ? 'h-[100dvh]' : 'h-full';

  const statusDotClass = useMemo(() => {
    if (status === 'connected') return 'bg-mint';
    if (status === 'connecting') return 'bg-butter animate-pulse';
    if (status === 'error') return 'bg-blush';
    return 'bg-midnight-text3';
  }, [status]);

  return (
    <div
      data-accent="peach"
      className={`flex min-h-0 flex-col ${rootHeight} w-full overflow-hidden ${className}`.trim()}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b border-midnight-border px-3 py-2"
        style={{ background: 'var(--midnight-surface-1)' }}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
        <span className="text-xs uppercase tracking-wider text-midnight-text2">
          {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Error' : 'Offline'}
        </span>
        <div className="min-w-0 flex-1 truncate text-sm text-midnight-text" title={tabTitle || tabUrl}>
          {tabTitle || tabUrl || 'No active tab'}
        </div>
        <button
          type="button"
          aria-pressed={takeControl}
          onClick={() => setTakeControl((v) => !v)}
          className={`btn mobile-touch-target ${takeControl ? 'btn-pill-light' : 'btn-pill'}`}
        >
          {takeControl ? <Unlock className="mr-1 h-4 w-4" /> : <Lock className="mr-1 h-4 w-4" />}
          {takeControl ? 'Controlling' : 'View only'}
        </button>
        {tabUrl ? (
          <a
            href={tabUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open tab in browser"
            className="btn btn-ghost mobile-touch-target"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
        style={{ background: 'var(--midnight-surface-0)' }}
      >
        {status === 'error' ? (
          <div className="ds-tile ds-pastel-peach flex max-w-md items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-peach" aria-hidden="true" />
            <div>
              <div className="mb-1 text-sm font-semibold text-midnight-text">Chrome viewport unavailable</div>
              <div className="text-xs text-midnight-text2">
                {errorMsg || 'Make sure Chrome is launched with --remote-debugging-port=9222.'}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="ds-tile-plain relative flex h-full w-full items-center justify-center overflow-hidden p-0"
            style={{ padding: 0 }}
          >
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              role="img"
              aria-label="Live Chrome viewport"
              tabIndex={takeControl ? 0 : -1}
              className="max-h-full max-w-full"
              style={{
                cursor: takeControl ? 'crosshair' : 'default',
                pointerEvents: takeControl ? 'auto' : 'none',
                touchAction: takeControl ? 'none' : 'auto',
              }}
              onMouseDown={(e) => handleMouseEvent(e, 'mousePressed')}
              onMouseUp={(e) => handleMouseEvent(e, 'mouseReleased')}
              onMouseMove={(e) => handleMouseEvent(e, 'mouseMoved')}
              onContextMenu={(e) => { if (takeControlRef.current) e.preventDefault(); }}
              onWheel={handleWheel}
            />
            {!takeControl && status === 'connected' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <span className="ds-chip ds-chip-mint inline-flex items-center gap-1 text-xs">
                  <MousePointer2 className="h-3 w-3" aria-hidden="true" />
                  Tap “View only” to take control
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
