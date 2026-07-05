import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';
import { createWebSocketOutbox } from './webSocketOutbox';

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries `kind` for provider messages and gateway messages. Synthetic
 * `websocket_reconnected`, `websocket_send_queued`, and `websocket_send_failed`
 * frames are injected client-side for reconnect/send state.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};

type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  subscribe: (listener: ServerEventListener) => () => void;
  latestMessage: ServerEvent | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null, hasAuthenticatedUser: boolean) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`;
  if (!token && hasAuthenticatedUser) return `${protocol}//${window.location.host}/ws`;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const { token, updateToken, user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const listenersRef = useRef(new Set<ServerEventListener>());
  const outboxRef = useRef(createWebSocketOutbox());
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    try {
      const wsUrl = buildWebSocketUrl(token, Boolean(user));
      if (!wsUrl) {
        console.warn('No authentication token found for WebSocket connection');
        return;
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        wsRef.current = websocket;
        outboxRef.current.flush((payload) => websocket.send(payload));

        if (hasConnectedRef.current) {
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          if (data.kind === 'auth_refresh' && typeof data.token === 'string') {
            updateToken(data.token);
          }
          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!unmountedRef.current) {
            connect();
          }
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [dispatch, token, updateToken, user]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }

    if (outboxRef.current.enqueue(message)) {
      dispatch({
        kind: 'websocket_send_queued',
        queuedCount: outboxRef.current.size(),
      });
      return;
    }

    dispatch({ kind: 'websocket_send_failed', reason: 'outbox_full' });
    console.warn('WebSocket not connected');
  }, [dispatch]);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return useMemo(() => ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    latestMessage,
    isConnected,
  }), [isConnected, latestMessage, sendMessage, subscribe]);
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
