import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { IS_PLATFORM } from '@/shared/utils';
import { expireAuthSession, isAuthTokenExpired } from '@/shared/authToken';

/**
 * Owns the /browser-view WebSocket for the live browser side panel: subscribe /
 * unsubscribe signaling, binary JPEG frame decoding into object URLs, reconnect
 * with backoff, visibility-driven pause, and coalesced input forwarding.
 */

/** Mirrors the server's control protocol states for the panel's status badge. */
export type BrowserViewStreamStatus = 'idle' | 'connecting' | 'live' | 'paused' | 'reconnecting' | 'stopped' | 'error';

/** Session metadata pushed by the server alongside frames; read-only for the viewer. */
export type BrowserViewSessionMeta = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  viewport: { width: number; height: number } | null;
  lastAction: string | null;
  cursor: { x: number; y: number; actor: 'agent' } | null;
};

/** Normalized input event forwarded to the agent's browser. Coordinates are in [0, 1] frame space. */
export type BrowserViewInputEvent =
  | { kind: 'mouse'; action: 'move' | 'down' | 'up'; u: number; v: number; button: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: string[] }
  | { kind: 'wheel'; u: number; v: number; deltaX: number; deltaY: number; modifiers?: string[] }
  | { kind: 'key'; action: 'down' | 'up'; key: string; code?: string; text?: string; repeat?: boolean; location?: number; modifiers?: string[] }
  | { kind: 'text'; text: string };

const FRAME_HEADER_SIZE = 5;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 8_000;
/** Client-side cap on forwarded input events; the server enforces its own bucket as the authority. */
const INPUT_EVENTS_PER_SECOND = 60;

function buildBrowserViewUrl(token: string | null): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/browser-view`;
  }
  if (!token) return null;
  if (isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return `${protocol}//${window.location.host}/browser-view?token=${encodeURIComponent(token)}`;
}

/** Letterboxed content rectangle for a frame of frameWidth×frameHeight inside a container, preserving aspect ratio. Used by BrowserViewSidePanel and module tests. */
export function computeContentRect(
  containerWidth: number,
  containerHeight: number,
  frameWidth: number,
  frameHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(containerWidth / frameWidth, containerHeight / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Maps a pointer position inside the viewing container onto normalized frame
 * coordinates, accounting for letterboxing. Returns null for points outside
 * the content. Used by BrowserViewSidePanel and module tests.
 */
export function mapClientPointToFrame(
  contentRect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  container: { left: number; top: number },
): { u: number; v: number } | null {
  if (contentRect.width <= 0 || contentRect.height <= 0) {
    return null;
  }
  const x = clientX - container.left - contentRect.left;
  const y = clientY - container.top - contentRect.top;
  if (x < 0 || y < 0 || x > contentRect.width || y > contentRect.height) {
    return null;
  }
  return {
    u: Math.min(1, x / contentRect.width),
    v: Math.min(1, y / contentRect.height),
  };
}

type UseBrowserViewStreamOptions = {
  /** Session to watch; null or false active keeps the socket closed. */
  sessionId: string | null;
  /** False closes the subscription (panel hidden or closed) without dropping session state. */
  active: boolean;
};

type UseBrowserViewStreamResult = {
  status: BrowserViewStreamStatus;
  /** Bounded error code from the server (unauthorized, session_unavailable, ...) or null. */
  errorCode: string | null;
  sessionMeta: BrowserViewSessionMeta | null;
  /** Object URL of the latest frame; revoked and replaced as frames arrive. */
  frameUrl: string | null;
  frameSize: { width: number; height: number } | null;
  /** Delivered frames per second, measured over the last second. */
  fps: number;
  viewerCount: number;
  /** Forwards one input event; drops events while disconnected or over the client rate cap. */
  sendInput: (event: BrowserViewInputEvent) => void;
};

export function useBrowserViewStream({ sessionId, active }: UseBrowserViewStreamOptions): UseBrowserViewStreamResult {
  const { isLoading: isAuthLoading, token } = useAuth();

  // Frame bookkeeping lives in refs so the (hot) frame path never re-renders
  // the tree; only the derived display state below is React state.
  const [status, setStatus] = useState<BrowserViewStreamStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [sessionMeta, setSessionMeta] = useState<BrowserViewSessionMeta | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [fps, setFps] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const subscriptionIdRef = useRef<number | null>(null);
  const sessionMetaRef = useRef<BrowserViewSessionMeta | null>(null);
  const frameCountRef = useRef(0);
  const lastFrameUrlRef = useRef<string | null>(null);
  const inputTimesRef = useRef<number[]>([]);
  const pendingMoveRef = useRef<BrowserViewInputEvent | null>(null);
  const deliberateCloseRef = useRef(false);

  const sendJson = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const flushPendingMove = useCallback(() => {
    const move = pendingMoveRef.current;
    if (!move) {
      return;
    }
    pendingMoveRef.current = null;
    sendJson({ type: 'view_input', input: move });
  }, [sendJson]);

  const sendInput = useCallback((event: BrowserViewInputEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Pointer moves are coalesced to animation-frame granularity; everything
    // else is forwarded immediately under a simple per-second cap.
    if (event.kind === 'mouse' && event.action === 'move') {
      pendingMoveRef.current = event;
      return;
    }

    const now = Date.now();
    inputTimesRef.current = inputTimesRef.current.filter((time) => now - time < 1_000);
    if (inputTimesRef.current.length >= INPUT_EVENTS_PER_SECOND) {
      return;
    }
    inputTimesRef.current.push(now);
    sendJson({ type: 'view_input', input: event });
  }, [sendJson]);

  // Animation-frame flush loop for coalesced pointer moves.
  useEffect(() => {
    if (!active) {
      return;
    }
    let stopped = false;
    let rafHandle = 0;
    const tick = () => {
      if (stopped) {
        return;
      }
      flushPendingMove();
      rafHandle = window.requestAnimationFrame(tick);
    };
    rafHandle = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(rafHandle);
    };
  }, [active, flushPendingMove]);

  // Delivered-fps readout, sampled once per second.
  useEffect(() => {
    if (!active) {
      setFps(0);
      return;
    }
    const timer = window.setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  // One effect owns the socket for a (session, active, token) combination; a
  // deliberate teardown marks the close so the reconnect logic stays quiet.
  useEffect(() => {
    if (!active || !sessionId) {
      deliberateCloseRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      subscriptionIdRef.current = null;
      setStatus((current) => (current === 'live' || current === 'connecting' || current === 'reconnecting' ? 'paused' : current));
      return;
    }
    if (!IS_PLATFORM && (isAuthLoading || !token)) {
      return;
    }

    deliberateCloseRef.current = false;
    let disposed = false;
    let reconnectDelay = RECONNECT_BASE_DELAY_MS;
    let reconnectTimer = 0;
    let socket: WebSocket | null = null;

    const revokeLastFrame = () => {
      if (lastFrameUrlRef.current) {
        URL.revokeObjectURL(lastFrameUrlRef.current);
        lastFrameUrlRef.current = null;
      }
    };

    const teardown = () => {
      deliberateCloseRef.current = true;
      socket?.close();
      socket = null;
      wsRef.current = null;
      subscriptionIdRef.current = null;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      const url = buildBrowserViewUrl(token ?? null);
      if (!url) {
        setStatus('error');
        setErrorCode('unauthorized');
        return;
      }

      setStatus((current) => (current === 'live' ? 'reconnecting' : 'connecting'));
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }
        reconnectDelay = RECONNECT_BASE_DELAY_MS;
        setErrorCode(null);
        sendJson({ type: 'view_subscribe', sessionId });
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          handleBinaryFrame(event.data);
          return;
        }
        handleJsonMessage(event.data as string);
      };

      socket.onclose = () => {
        if (disposed || deliberateCloseRef.current) {
          return;
        }
        // The server closes with 4001 when per-message re-authentication
        // fails; retrying cannot succeed, so surface it instead.
        setStatus('reconnecting');
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
      };

      socket.onerror = () => {
        // onclose follows onerror; reconnect handling lives there.
      };
    };

    const handleJsonMessage = (text: string) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.type === 'view_state') {
        const messageSubscriptionId = typeof message.subscriptionId === 'number' ? message.subscriptionId : null;
        if (messageSubscriptionId !== null) {
          subscriptionIdRef.current = messageSubscriptionId;
        }
        if (message.state === 'live') {
          setStatus('live');
        } else if (message.state === 'stopped') {
          setStatus('stopped');
        }
        if (message.session && typeof message.session === 'object') {
          const session = message.session as BrowserViewSessionMeta;
          sessionMetaRef.current = session;
          setSessionMeta(session);
        }
        if (typeof message.viewerCount === 'number') {
          setViewerCount(message.viewerCount);
        }
        return;
      }

      if (message.type === 'view_meta' && typeof message.subscriptionId === 'number'
        && message.subscriptionId === subscriptionIdRef.current) {
        if (message.session && typeof message.session === 'object') {
          const session = message.session as BrowserViewSessionMeta;
          sessionMetaRef.current = session;
          setSessionMeta(session);
        }
        if (typeof message.viewerCount === 'number') {
          setViewerCount(message.viewerCount);
        }
        return;
      }

      if (message.type === 'view_error') {
        const code = typeof message.code === 'string' ? message.code : 'error';
        if (code === 'unauthorized') {
          setStatus('error');
          setErrorCode(code);
          deliberateCloseRef.current = true;
          socket?.close();
          return;
        }
        if (code === 'session_unavailable') {
          setStatus('stopped');
          setErrorCode(code);
          return;
        }
        setErrorCode(code);
      }
    };

    const handleBinaryFrame = (buffer: ArrayBuffer) => {
      if (buffer.byteLength <= FRAME_HEADER_SIZE) {
        return;
      }
      const header = new DataView(buffer, 0, FRAME_HEADER_SIZE);
      if (header.getUint8(0) !== 0xcf) {
        return;
      }
      const frameSubscriptionId = header.getUint32(1, true);
      if (subscriptionIdRef.current === null || frameSubscriptionId !== subscriptionIdRef.current) {
        return;
      }

      const blob = new Blob([buffer.slice(FRAME_HEADER_SIZE)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const previous = lastFrameUrlRef.current;
      lastFrameUrlRef.current = url;
      frameCountRef.current += 1;
      setFrameUrl(url);
      if (previous) {
        URL.revokeObjectURL(previous);
      }
    };

    const handleVisibility = () => {
      // Hidden documents stop frame delivery at the source; visibility is
      // cheap to re-check and avoids streaming to a tab nobody is watching.
      if (document.visibilityState === 'hidden') {
        sendJson({ type: 'view_unsubscribe' });
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendJson({ type: 'view_subscribe', sessionId });
      }
    };

    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      teardown();
      revokeLastFrame();
    };
  }, [active, sessionId, token, isAuthLoading, sendJson]);

  // Reset display state when switching sessions so stale frames never render
  // against the new session's metadata.
  useEffect(() => {
    sessionMetaRef.current = null;
    setSessionMeta(null);
    if (lastFrameUrlRef.current) {
      URL.revokeObjectURL(lastFrameUrlRef.current);
      lastFrameUrlRef.current = null;
    }
    setFrameUrl(null);
    setFrameSize(null);
    frameCountRef.current = 0;
  }, [sessionId]);

  // Track the decoded frame dimensions for letterbox math; the img element
  // reports naturalWidth/Height once the first frame decodes.
  useEffect(() => {
    if (!frameUrl) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      setFrameSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = frameUrl;
  }, [frameUrl]);

  return {
    status,
    errorCode,
    sessionMeta,
    frameUrl,
    frameSize,
    fps,
    viewerCount,
    sendInput,
  };
}
