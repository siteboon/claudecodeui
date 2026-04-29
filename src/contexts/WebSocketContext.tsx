import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';
import { useAppLifecycle } from '../hooks/useAppLifecycle';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
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
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const HEARTBEAT_INTERVAL_MS = 25000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const RECONNECT_DELAY_MS = 3000;
const STALE_THRESHOLD_MS = 5000;
const PING_PROBE_TIMEOUT_MS = 2000;

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPongRef = useRef<number>(Date.now());
  const pingProbeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();
  const { onForeground, onBackground } = useAppLifecycle();

  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (pingProbeTimeoutRef.current) {
      clearTimeout(pingProbeTimeoutRef.current);
      pingProbeTimeoutRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeatIntervalRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // If we haven't received a pong in too long, the connection is dead
      if (Date.now() - lastPongRef.current > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
        console.warn('[WebSocket] Heartbeat timeout, forcing reconnect');
        clearHeartbeat();
        ws.close();
        return;
      }

      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (_) { /* socket closing */ }
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat]);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    try {
      const wsUrl = buildWebSocketUrl(token);
      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        wsRef.current = websocket;
        lastPongRef.current = Date.now();
        if (hasConnectedRef.current) {
          setLatestMessage({ type: 'websocket-reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
        startHeartbeat();
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Track application-level pongs for heartbeat
          if (data.type === 'pong') {
            lastPongRef.current = Date.now();
            if (pingProbeTimeoutRef.current) {
              clearTimeout(pingProbeTimeoutRef.current);
              pingProbeTimeoutRef.current = null;
            }
            return;
          }
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        clearHeartbeat();

        // Attempt to reconnect after delay (with jitter to avoid reconnect storms)
        const jitter = Math.random() * 1000;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          connect();
        }, RECONNECT_DELAY_MS + jitter);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, startHeartbeat, clearHeartbeat]);

  // Initial connection + cleanup
  useEffect(() => {
    connect();

    return () => {
      unmountedRef.current = true;
      clearHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  // Foreground: immediately check connection health and reconnect if needed
  useEffect(() => {
    const cleanup = onForeground((backgroundDurationMs) => {
      if (unmountedRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Socket is dead — cancel any pending reconnect and connect now
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        console.log('[WebSocket] Foreground resume: socket dead, reconnecting immediately');
        connect();
        return;
      }

      // Socket reports OPEN but may be stale after long backgrounding
      if (backgroundDurationMs > STALE_THRESHOLD_MS) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch (_) {
          connect();
          return;
        }
        // If no pong within timeout, force reconnect
        pingProbeTimeoutRef.current = setTimeout(() => {
          console.log('[WebSocket] Foreground resume: stale connection detected, reconnecting');
          ws.close();
        }, PING_PROBE_TIMEOUT_MS);
      }

      // Restart heartbeat (was paused during background)
      startHeartbeat();
    });

    return cleanup;
  }, [onForeground, connect, startHeartbeat]);

  // Background: pause heartbeat (no point sending pings while frozen)
  useEffect(() => {
    const cleanup = onBackground(() => {
      clearHeartbeat();
    });
    return cleanup;
  }, [onBackground, clearHeartbeat]);

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

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
