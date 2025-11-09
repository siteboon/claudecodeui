import { useState, useEffect, useCallback, useRef } from 'react';
import { usePermission } from '../contexts/PermissionContext';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { WS_MESSAGE_TYPES, PERMISSION_DECISIONS } from '../utils/permissionWebSocketClient';

/**
 * Custom hook for managing permission requests and responses
 * Integrates WebSocket messaging with the permission UI system
 */
const usePermissions = () => {
  const { enqueueRequest, handleDecision } = usePermission();
  const { wsClient, isConnected } = useWebSocketContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentRequest, setCurrentRequest] = useState(null);
  const responseCallbacksRef = useRef(new Map());

  // Handle incoming permission requests from WebSocket
  useEffect(() => {
    if (!wsClient) return;

    const handlePermissionRequest = (message) => {
      if (message.type === WS_MESSAGE_TYPES.PERMISSION_REQUEST) {
        const request = {
          id: message.id,
          tool: message.tool,
          operation: message.operation,
          description: message.description,
          input: message.input,
          timestamp: Date.now(),
        };

        // Check if auto-approved (session or permanent permission)
        const result = enqueueRequest(request);

        if (result.autoApproved) {
          // Send auto-approval response
          sendPermissionResponse(request.id, result.decision);
        } else {
          // Show dialog for manual approval
          setCurrentRequest(request);
          setIsDialogOpen(true);
        }
      } else if (message.type === WS_MESSAGE_TYPES.PERMISSION_TIMEOUT) {
        // Handle timeout from server
        handleDecision(message.id, PERMISSION_DECISIONS.DENY);
        if (currentRequest?.id === message.id) {
          setIsDialogOpen(false);
          setCurrentRequest(null);
        }
      }
    };

    // Add listener
    wsClient.addMessageListener(handlePermissionRequest);

    // Cleanup
    return () => {
      wsClient.removeMessageListener(handlePermissionRequest);
    };
  }, [wsClient, enqueueRequest, handleDecision, currentRequest]);

  // Send permission response via WebSocket
  const sendPermissionResponse = useCallback((requestId, decision, updatedInput = null) => {
    if (!wsClient || !isConnected) {
      console.error('WebSocket not connected');
      return false;
    }

    try {
      const response = {
        type: WS_MESSAGE_TYPES.PERMISSION_RESPONSE,
        id: requestId,
        decision,
        updatedInput,
        timestamp: Date.now(),
      };

      wsClient.send(response);

      // Execute any registered callbacks
      const callback = responseCallbacksRef.current.get(requestId);
      if (callback) {
        callback({ decision, updatedInput });
        responseCallbacksRef.current.delete(requestId);
      }

      // Log for analytics
      logPermissionDecision(requestId, decision);

      return true;
    } catch (error) {
      console.error('Failed to send permission response:', error);
      return false;
    }
  }, [wsClient, isConnected]);

  // Handle dialog decision
  const handleDialogDecision = useCallback((requestId, decision, updatedInput = null) => {
    // Update context state
    const result = handleDecision(requestId, decision, updatedInput);

    if (result) {
      // Send WebSocket response
      sendPermissionResponse(result.id, result.decision, result.updatedInput);

      // Close dialog if this was the current request
      if (currentRequest?.id === requestId) {
        setIsDialogOpen(false);
        setCurrentRequest(null);
      }
    }
  }, [handleDecision, sendPermissionResponse, currentRequest]);

  // Register a callback for when a specific permission is decided
  const onPermissionDecided = useCallback((requestId, callback) => {
    responseCallbacksRef.current.set(requestId, callback);
  }, []);

  // Close dialog
  const closeDialog = useCallback(() => {
    if (currentRequest) {
      handleDialogDecision(currentRequest.id, PERMISSION_DECISIONS.DENY);
    }
    setIsDialogOpen(false);
    setCurrentRequest(null);
  }, [currentRequest, handleDialogDecision]);

  // Mock a permission request for testing
  const mockPermissionRequest = useCallback((tool = 'bash', operation = 'execute') => {
    const mockRequest = {
      type: WS_MESSAGE_TYPES.PERMISSION_REQUEST,
      id: `mock-${Date.now()}`,
      tool,
      operation,
      description: `Mock permission request for ${tool} ${operation}`,
      input: { command: 'ls -la', path: '/home/user' },
    };

    if (wsClient) {
      // Simulate receiving a WebSocket message
      wsClient.simulateMessage?.(mockRequest);
    } else {
      // Direct handling for testing without WebSocket
      const request = {
        id: mockRequest.id,
        tool: mockRequest.tool,
        operation: mockRequest.operation,
        description: mockRequest.description,
        input: mockRequest.input,
        timestamp: Date.now(),
      };

      enqueueRequest(request);
      setCurrentRequest(request);
      setIsDialogOpen(true);
    }
  }, [wsClient, enqueueRequest]);

  // Analytics logging
  const logPermissionDecision = (requestId, decision) => {
    // Track permission decisions for analytics
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'permission_decision', {
        request_id: requestId,
        decision,
        timestamp: Date.now(),
      });
    }

    // Store in local history
    const history = JSON.parse(localStorage.getItem('permissionHistory') || '[]');
    history.push({
      requestId,
      decision,
      timestamp: Date.now(),
    });

    // Keep only last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    localStorage.setItem('permissionHistory', JSON.stringify(history));
  };

  // Get permission statistics
  const getPermissionStats = useCallback(() => {
    const history = JSON.parse(localStorage.getItem('permissionHistory') || '[]');
    const stats = {
      total: history.length,
      allowed: 0,
      denied: 0,
      allowedSession: 0,
      allowedAlways: 0,
    };

    history.forEach(entry => {
      switch (entry.decision) {
        case PERMISSION_DECISIONS.ALLOW:
          stats.allowed++;
          break;
        case PERMISSION_DECISIONS.DENY:
          stats.denied++;
          break;
        case PERMISSION_DECISIONS.ALLOW_SESSION:
          stats.allowedSession++;
          break;
        case PERMISSION_DECISIONS.ALLOW_ALWAYS:
          stats.allowedAlways++;
          break;
      }
    });

    return stats;
  }, []);

  // Clear permission history
  const clearPermissionHistory = useCallback(() => {
    localStorage.removeItem('permissionHistory');
    localStorage.removeItem('permanentPermissions');
  }, []);

  return {
    // State
    isDialogOpen,
    currentRequest,
    isConnected,

    // Actions
    sendPermissionResponse,
    handleDialogDecision,
    closeDialog,
    onPermissionDecided,
    mockPermissionRequest,

    // Analytics
    getPermissionStats,
    clearPermissionHistory,
  };
};

export default usePermissions;