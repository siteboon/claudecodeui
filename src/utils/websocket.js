import { useState, useEffect, useRef } from 'react';
import permissionWebSocketClient from './permissionWebSocketClient';

export function useWebSocket() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState([]);
  const [permissionQueueStatus, setPermissionQueueStatus] = useState({ pending: 0, processing: 0 });
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    // Set up permission client handlers
    permissionWebSocketClient.setHandlers({
      onRequestReceived: (request) => {
        setPendingPermissions(prev => [...prev, request]);
      },
      onRequestTimeout: (request) => {
        setPendingPermissions(prev => prev.filter(r => r.id !== request.id));
      },
      onQueueStatusUpdate: (status) => {
        setPermissionQueueStatus(status);
      },
      onError: (error) => {
        console.error('Permission error:', error);
      }
    });

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.close();
      }
      permissionWebSocketClient.cleanup();
    };
  }, []); // Keep dependency array but add proper cleanup

  const connect = async () => {
    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';

      // Construct WebSocket URL
      let wsUrl;

      if (isPlatform) {
        // Platform mode: Use same domain as the page (goes through proxy)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws`;
      } else {
        // OSS mode: Connect to same host:port that served the page
        const token = localStorage.getItem('auth-token');
        if (!token) {
          console.warn('No authentication token found for WebSocket connection');
          return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        setWs(websocket);

        // Initialize permission WebSocket client
        permissionWebSocketClient.initialize(websocket);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Let permission client handle permission-related messages
          permissionWebSocketClient.handleMessage(data);

          // Continue to pass all messages to the main messages state
          setMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        setWs(null);

        // Clean up permission client
        permissionWebSocketClient.handleConnectionStateChange('disconnected');

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
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

  const sendMessage = (message) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  };

  const sendPermissionResponse = (requestId, decision, updatedInput = null) => {
    const success = permissionWebSocketClient.sendResponse(requestId, decision, updatedInput);
    if (success) {
      // Remove from pending permissions
      setPendingPermissions(prev => prev.filter(r => r.id !== requestId));
    }
    return success;
  };

  const clearPermissionRequest = (requestId) => {
    permissionWebSocketClient.clearRequest(requestId);
    setPendingPermissions(prev => prev.filter(r => r.id !== requestId));
  };

  return {
    ws,
    wsClient: permissionWebSocketClient,
    sendMessage,
    messages,
    isConnected,
    pendingPermissions,
    permissionQueueStatus,
    sendPermissionResponse,
    clearPermissionRequest
  };
}
