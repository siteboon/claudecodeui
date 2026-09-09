import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { IS_PLATFORM } from '@/shared/utils';
import { expireAuthSession, isAuthTokenExpired } from '@/shared/authToken';
import type { ServerEvent } from '@/shared/types';


type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  /** The open chat socket; null until a replacement handshake completes. */
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames cannot be coalesced or
   * dropped. Frames are deliberately not copied into React state; each
   * listener updates only the state owned by the feature that handles it.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const RECONNECT_DELAY_MS = 3_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 3_000;
const CONNECT_TIMEOUT_MS = 30_000;

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
  if (isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  // Lets sendMessage retire a failed socket through the active auth effect.
  const retireSocketRef = useRef<(socket: WebSocket) => void>(() => {});
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [isConnected, setIsConnected] = useState(false);
  const { isLoading: isAuthLoading, token, user } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (!IS_PLATFORM && (isAuthLoading || !user)) {
      return;
    }

    let disposed = false;
    // One deadline owns the handshake, next ping, pending pong, or retry.
    let timer: number | null = null;
    let pendingNonce: string | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (callback: () => void, delay: number) => {
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        if (!disposed) callback();
      }, delay);
    };

    const closeSocket = (socket: WebSocket) => {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };

    const retireSocket = (socket: WebSocket) => {
      if (disposed || wsRef.current !== socket) return;
      pendingNonce = null;
      wsRef.current = null;
      setIsConnected(false);
      closeSocket(socket);
      schedule(connect, RECONNECT_DELAY_MS);
    };
    retireSocketRef.current = retireSocket;

    const probe = () => {
      const socket = wsRef.current;
      if (!socket) {
        // Resume events must not keep restarting an already scheduled retry.
        if (timer === null) connect();
        return;
      }
      if (socket.readyState === WebSocket.CONNECTING || pendingNonce !== null) return;
      if (socket.readyState !== WebSocket.OPEN) {
        retireSocket(socket);
        return;
      }

      pendingNonce = `ping-${Date.now()}-${Math.random()}`;
      schedule(() => retireSocket(socket), PONG_TIMEOUT_MS);
      try {
        socket.send(JSON.stringify({ type: 'chat.ping', nonce: pendingNonce }));
      } catch {
        retireSocket(socket);
      }
    };

    function connect() {
      if (disposed || wsRef.current) return;
      const wsUrl = buildWebSocketUrl(token);
      if (!wsUrl) return;

      try {
        const websocket = new WebSocket(wsUrl);
        wsRef.current = websocket;
        // A handshake can stall without either an open or a close event.
        schedule(() => retireSocket(websocket), CONNECT_TIMEOUT_MS);

        websocket.onopen = () => {
          if (disposed || wsRef.current !== websocket) return;
          schedule(probe, PING_INTERVAL_MS);
          setIsConnected(true);
          if (hasConnectedRef.current) {
            dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
          }
          hasConnectedRef.current = true;
        };

        websocket.onmessage = (event) => {
          if (disposed || wsRef.current !== websocket) return;
          try {
            const data = JSON.parse(event.data) as ServerEvent;
            if (data.kind === 'pong') {
              if (pendingNonce !== null && data.nonce === pendingNonce) {
                pendingNonce = null;
                schedule(probe, PING_INTERVAL_MS);
              }
              return;
            }
            dispatch(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        websocket.onclose = () => retireSocket(websocket);
        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
          retireSocket(websocket);
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
        schedule(connect, RECONNECT_DELAY_MS);
      }
    }

    const handleResume = () => {
      if (document.visibilityState === 'visible') probe();
    };

    connect();
    // Timers also detect half-open sockets without a page event. Browsers can
    // throttle these while suspended; resume probes do not extend a pong deadline.
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('pageshow', handleResume);
    return () => {
      disposed = true;
      clearTimer();
      pendingNonce = null;
      retireSocketRef.current = () => {};
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('pageshow', handleResume);
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) closeSocket(socket);
      setIsConnected(false);
    };
  }, [dispatch, isAuthLoading, token, user]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      try {
        socket.send(payload);
      } catch (error) {
        console.error('WebSocket send error:', error);
        retireSocketRef.current(socket);
      }
    } else {
      console.warn('WebSocket not connected');
      if (socket && socket.readyState !== WebSocket.CONNECTING) {
        retireSocketRef.current(socket);
      }
    }
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: isConnected ? wsRef.current : null,
    sendMessage,
    subscribe,
    isConnected
  }), [sendMessage, subscribe, isConnected]);

  return value;
};

/** Mounted once by App; owns the single chat websocket that the chat, project-workspace and task-master modules subscribe to. */
export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
