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
      // Get authentication token
      const token = localStorage.getItem('auth-token');
      if (!token) {
        console.warn('No authentication token found for WebSocket connection');
        return;
      }
      
      // Fetch server configuration to get the correct WebSocket URL
      let wsBaseUrl;
      try {
        const configResponse = await fetch('/api/config', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const config = await configResponse.json();
        wsBaseUrl = config.wsUrl;
        
        // If the config returns localhost but we're not on localhost, use current host but with API server port
        if (wsBaseUrl.includes('localhost') && !window.location.hostname.includes('localhost')) {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          // For development, API server is typically on port 3002 when Vite is on 3001
          const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
          wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
        }
      } catch (error) {
        console.warn('Could not fetch server config, falling back to current host with API server port');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // For development, API server is typically on port 3002 when Vite is on 3001
        const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
        wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
      }
      
      // Include token in WebSocket URL as query parameter
      const wsUrl = `${wsBaseUrl}/ws?token=${encodeURIComponent(token)}`;
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
