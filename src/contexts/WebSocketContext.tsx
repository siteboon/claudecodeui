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

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const webSocketPath = withBasePath('/ws');
  if (IS_PLATFORM) return `${protocol}//${window.location.host}${webSocketPath}`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}${webSocketPath}?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
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
    connect();
    
    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');
      
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
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
          // This is a reconnect — signal so components can catch up on missed messages
          setLatestMessage({ type: 'websocket-reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
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
