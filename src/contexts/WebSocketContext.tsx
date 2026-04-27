import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';
import { withBasePath } from '../utils/basePath.js';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
  // Number of sends that were issued while the socket was closed and are
  // waiting to be flushed on the next onopen. Surfaced so the UI can show a
  // "still sending..." indicator instead of letting the user think their
  // message went through.
  pendingSendCount: number;
  // The most recent payload's user-facing text (the `command` field of
  // claude/cursor/codex/gemini-command frames), or null if unknown. Lets the
  // UI display *what* is queued, not just that something is.
  lastPendingSendText: string | null;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const webSocketPath = withBasePath('/ws');
  return `${protocol}//${window.location.host}${webSocketPath}`;
};

// Encode a JWT for transport via Sec-WebSocket-Protocol. The browser
// WebSocket constructor only allows headers via the `protocols` arg, so
// we frame the bearer token as a subprotocol value (`bearer.<encoded>`).
// The server reads it in verifyClient and echoes it back via handleProtocols.
// JWTs contain dots; URL-encode so the protocol token has exactly one
// `bearer.` prefix and is otherwise opaque.
const buildBearerSubprotocol = (token: string): string =>
  `bearer.${encodeURIComponent(token)}`;

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  // Messages whose callers tried to send while the socket was closed (reconnecting,
  // not yet opened, etc.). Flushed in onopen so callers never silently lose a send.
  const pendingSendQueueRef = useRef<string[]>([]);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [pendingSendCount, setPendingSendCount] = useState(0);
  const [lastPendingSendText, setLastPendingSendText] = useState<string | null>(null);

  const extractCommandText = (payload: string): string | null => {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed.command === 'string') return parsed.command;
    } catch { /* ignore */ }
    return null;
  };
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  useEffect(() => {
    // Per-effect-run flag. When this effect's cleanup runs (token change or
    // unmount), we set cancelled=true on the OLD closure so any in-flight
    // close/reconnect path bails instead of opening a parallel socket with a
    // stale token. The next effect run gets its own fresh `cancelled=false`.
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        const wsUrl = buildWebSocketUrl();
        // Platform mode: server identifies user from request, no JWT needed.
        // OSS mode: bail out until we have a token rather than opening an
        // unauthenticated connection that the server will reject.
        if (!IS_PLATFORM && !token) {
          return console.warn('No authentication token found for WebSocket connection');
        }

        const websocket = !IS_PLATFORM && token
          ? new WebSocket(wsUrl, [buildBearerSubprotocol(token)])
          : new WebSocket(wsUrl);

        websocket.onopen = () => {
          if (cancelled) {
            try { websocket.close(); } catch { /* ignore */ }
            return;
          }
          wsRef.current = websocket;
          setIsConnected(true);
          // Flush messages that callers tried to send while the socket was closed.
          // Previously these were dropped with a console.warn, which silently lost
          // user messages sent during the 3s reconnect window.
          if (pendingSendQueueRef.current.length > 0) {
            const queued = pendingSendQueueRef.current;
            pendingSendQueueRef.current = [];
            setPendingSendCount(0);
            setLastPendingSendText(null);
            for (const payload of queued) {
              try {
                websocket.send(payload);
              } catch (err) {
                console.error('Failed to flush queued WebSocket message:', err);
              }
            }
          }
          if (hasConnectedRef.current) {
            setLatestMessage({ type: 'websocket-reconnected', timestamp: Date.now() });
          }
          hasConnectedRef.current = true;
        };

        websocket.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data);
            setLatestMessage(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        websocket.onclose = () => {
          if (wsRef.current === websocket) {
            wsRef.current = null;
            setIsConnected(false);
          }
          if (cancelled) return;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (cancelled) return;
            connect();
          }, 3000);
        };

        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    const payload = JSON.stringify(message);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return;
    }
    // Socket is closed or still connecting — queue the payload so it flushes on
    // the next onopen rather than being silently dropped. The context reconnects
    // every 3s after an onclose, so the queue drains quickly in practice.
    const queue = pendingSendQueueRef.current;
    // Bound the queue so a prolonged outage can't grow memory without limit.
    // Drop the oldest payload on overflow (newer sends reflect the user's
    // latest intent, so keeping those is more useful than the stale oldest).
    if (queue.length >= 50) {
      queue.shift();
    }
    queue.push(payload);
    setPendingSendCount(queue.length);
    const text = extractCommandText(payload);
    if (text !== null) setLastPendingSendText(text);
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected,
    pendingSendCount,
    lastPendingSendText,
  }), [sendMessage, latestMessage, isConnected, pendingSendCount, lastPendingSendText]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
