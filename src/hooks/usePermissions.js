import { useState, useEffect, useCallback, useRef } from 'react';
import { usePermission } from '../contexts/PermissionContext';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { WS_MESSAGE_TYPES, PERMISSION_DECISIONS } from '../utils/permissionWebSocketClient';
import { savePendingRequest, removePendingRequest } from '../utils/permissionStorage';

// Analytics logging helper
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

/**
 * Custom hook for managing permission requests and responses
 * Integrates WebSocket messaging with the permission UI system
 */
const usePermissions = () => {
  const { enqueueRequest, handleDecision, activeRequest, currentSessionId, isRestoring } = usePermission();
  const { wsClient, isConnected } = useWebSocketContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentRequest, setCurrentRequest] = useState(null);
  const responseCallbacksRef = useRef(new Map());
  const hasSyncedRef = useRef(false);

  // Send permission sync request when WebSocket connects with a session
  useEffect(() => {
    if (!wsClient || !isConnected || !currentSessionId || hasSyncedRef.current) {
      return;
    }

    console.log('🔄 [Permission] Sending sync request for session:', currentSessionId);
    hasSyncedRef.current = true;

    try {
      wsClient.send({
        type: 'permission-sync-request',
        sessionId: currentSessionId
      });
    } catch (error) {
      console.error('Failed to send permission sync request:', error);
      hasSyncedRef.current = false;
    }
  }, [wsClient, isConnected, currentSessionId]);

  // Reset sync flag when session changes
  useEffect(() => {
    hasSyncedRef.current = false;
  }, [currentSessionId]);

  // Handle incoming permission requests from WebSocket
  useEffect(() => {
    if (!wsClient) return;

    const handlePermissionRequest = (message) => {
      console.log('📥 [WS] Received message:', {
        type: message.type,
        requestId: message.requestId || message.id,
        toolName: message.toolName || message.tool,
        timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : 'now'
      });

      if (message.type === WS_MESSAGE_TYPES.PERMISSION_REQUEST) {
        const request = {
          id: message.requestId || message.id,
          tool: message.toolName || message.tool,
          operation: message.operation || 'execute',
          description: message.description || `Use ${message.toolName || message.tool}`,
          input: message.input,
          timestamp: message.timestamp || Date.now(),
        };

        console.log('📥 [Permission] Processing WS request:', request);

        // Save to sessionStorage for persistence
        if (currentSessionId) {
          savePendingRequest(currentSessionId, request);
        }

        // Check if auto-approved (session or permanent permission)
        const result = enqueueRequest(request);

        if (result.autoApproved) {
          console.log('⚡ [Permission] WS request auto-approved, sending response:', {
            id: request.id,
            decision: result.decision
          });
          // Send auto-approval response
          sendPermissionResponse(request.id, result.decision);
          // Remove from storage since it was auto-approved
          if (currentSessionId) {
            removePendingRequest(currentSessionId, request.id);
          }
        } else {
          console.log('🔔 [Permission] Showing dialog for:', request.id);
          // Show dialog for manual approval
          setCurrentRequest(request);
          setIsDialogOpen(true);
        }
      } else if (message.type === WS_MESSAGE_TYPES.PERMISSION_TIMEOUT) {
        const reqId = message.requestId || message.id;
        console.log('⏱️ [Permission] Timeout received for:', reqId);
        // Handle timeout from server
        handleDecision(reqId, PERMISSION_DECISIONS.DENY);
        // Remove from storage
        if (currentSessionId) {
          removePendingRequest(currentSessionId, reqId);
        }
        if (currentRequest?.id === reqId) {
          setIsDialogOpen(false);
          setCurrentRequest(null);
        }
      } else if (message.type === 'permission-sync-response') {
        console.log('🔄 [Permission] Received sync response:', {
          sessionId: message.sessionId,
          count: message.pendingRequests?.length || 0
        });

        // Merge server-side pending requests with local state
        if (message.pendingRequests && message.pendingRequests.length > 0) {
          message.pendingRequests.forEach(serverRequest => {
            const request = {
              id: serverRequest.requestId,
              tool: serverRequest.toolName,
              operation: 'execute',
              description: `Use ${serverRequest.toolName}`,
              input: serverRequest.input,
              timestamp: serverRequest.timestamp || Date.now(),
            };

            // Save to sessionStorage
            if (currentSessionId) {
              savePendingRequest(currentSessionId, request);
            }

            // Add to queue if not already present
            const result = enqueueRequest(request);
            if (!result.autoApproved && !currentRequest) {
              console.log('🔔 [Permission] Showing dialog for synced request:', request.id);
              setCurrentRequest(request);
              setIsDialogOpen(true);
            }
          });
        }
      }
    };

    // Add listener
    wsClient.addMessageListener(handlePermissionRequest);

    // Cleanup
    return () => {
      wsClient.removeMessageListener(handlePermissionRequest);
    };
  }, [wsClient, enqueueRequest, handleDecision, currentRequest, currentSessionId]);

  // Sync currentRequest with activeRequest from context
  // This ensures the dialog shows the next queued request after the current one is handled
  useEffect(() => {
    if (activeRequest && !currentRequest) {
      console.log('🔄 [Permission] Syncing with next queued request:', activeRequest.id);
      setCurrentRequest(activeRequest);
      setIsDialogOpen(true);
    } else if (!activeRequest && currentRequest) {
      // No active request but we have a current one - this shouldn't normally happen
      console.log('⚠️ [Permission] currentRequest exists but no activeRequest');
    }
  }, [activeRequest, currentRequest]);

  // Send permission response via WebSocket
  const sendPermissionResponse = useCallback((requestId, decision, updatedInput = null) => {
    // For mock requests, just log and return
    if (requestId?.startsWith('mock-')) {
      console.log('Mock permission decision:', { requestId, decision, updatedInput });
      logPermissionDecision(requestId, decision);
      return true;
    }

    if (!wsClient || !isConnected) {
      console.error('WebSocket not connected');
      return false;
    }

    try {
      console.log('📤 Sending permission response:', { requestId, decision, updatedInput });

      // Use the wsClient's sendResponse method which properly cleans up pending requests
      const success = wsClient.sendResponse(requestId, decision, updatedInput);

      // Execute any registered callbacks
      const callback = responseCallbacksRef.current.get(requestId);
      if (callback) {
        callback({ decision, updatedInput });
        responseCallbacksRef.current.delete(requestId);
      }

      // Log for analytics
      logPermissionDecision(requestId, decision);

      return success;
    } catch (error) {
      console.error('Failed to send permission response:', error);
      return false;
    }
  }, [wsClient, isConnected]);

  // Handle dialog decision
  const handleDialogDecision = useCallback((requestId, decision, updatedInput = null) => {
    console.log('👤 [Permission] User decision:', { requestId, decision, updatedInput });

    // Update context state
    const result = handleDecision(requestId, decision, updatedInput);

    if (result) {
      // Send WebSocket response
      sendPermissionResponse(result.id, result.decision, result.updatedInput);

      // Remove from sessionStorage since decision was made
      if (currentSessionId) {
        removePendingRequest(currentSessionId, requestId);
      }

      // Close dialog if this was the current request
      if (currentRequest?.id === requestId) {
        setCurrentRequest(null);
        setIsDialogOpen(false);
      }
    }
  }, [handleDecision, sendPermissionResponse, currentRequest, currentSessionId]);

  // Register a callback for when a specific permission is decided
  const onPermissionDecided = useCallback((requestId, callback) => {
    responseCallbacksRef.current.set(requestId, callback);
  }, []);

  // Close dialog (called when user closes dialog via X button without making a decision)
  const closeDialog = useCallback(() => {
    if (currentRequest) {
      console.log('🚫 [Permission] Dialog closed without decision, sending deny');
      handleDialogDecision(currentRequest.id, PERMISSION_DECISIONS.DENY);
    } else {
      console.log('✓ [Permission] Dialog closed, no current request');
      setIsDialogOpen(false);
      setCurrentRequest(null);
    }
  }, [currentRequest, handleDialogDecision]);

  // Mock a permission request for testing
  const mockPermissionRequest = useCallback((tool = 'bash', operation = 'execute') => {
    const mockRequest = {
      id: `mock-${Date.now()}`,
      tool,
      operation,
      description: `Mock permission request for ${tool} ${operation}`,
      input: { command: 'ls -la', path: '/home/user' },
      timestamp: Date.now(),
    };

    // Add the request to the queue
    const result = enqueueRequest(mockRequest);

    if (!result.autoApproved) {
      // Show dialog for manual approval
      setCurrentRequest(mockRequest);
      setIsDialogOpen(true);
    } else {
      // Auto-approved based on session/permanent permissions
      console.log('Request auto-approved:', mockRequest.id, result.decision);
    }
  }, [enqueueRequest]);


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