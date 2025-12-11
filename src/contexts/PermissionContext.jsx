import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { PERMISSION_DECISIONS, WS_MESSAGE_TYPES } from '../utils/permissionWebSocketClient';
import { getPendingRequests, savePendingRequest, removePendingRequest as removeFromStorage, clearAllRequests as clearStorage } from '../utils/permissionStorage';

const PermissionContext = createContext();

export const usePermission = () => {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermission must be used within a PermissionProvider');
  }
  return context;
};

export const PermissionProvider = ({ children, currentSessionId }) => {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [permissionHistory, setPermissionHistory] = useState([]);
  const [sessionPermissions, setSessionPermissions] = useState(new Map());
  const [permanentPermissions, setPermanentPermissions] = useState(new Map());
  const [isRestoring, setIsRestoring] = useState(false);
  const lastSessionIdRef = useRef(null);

  // Load permanent permissions from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('permanentPermissions');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setPermanentPermissions(new Map(parsed));
      } catch (error) {
        console.error('Failed to load permanent permissions:', error);
      }
    }
  }, []);

  // Save permanent permissions to localStorage when they change
  useEffect(() => {
    if (permanentPermissions.size > 0) {
      localStorage.setItem(
        'permanentPermissions',
        JSON.stringify(Array.from(permanentPermissions.entries()))
      );
    }
  }, [permanentPermissions]);

  // Restore pending requests from sessionStorage when session changes
  useEffect(() => {
    if (!currentSessionId) {
      if (lastSessionIdRef.current) {
        setPendingRequests([]);
        setActiveRequest(null);
      }
      lastSessionIdRef.current = null;
      return;
    }

    if (currentSessionId !== lastSessionIdRef.current) {
      lastSessionIdRef.current = currentSessionId;
      setIsRestoring(true);

      const restored = getPendingRequests(currentSessionId);
      console.log('🔄 [Permission] Restoring requests for session:', currentSessionId, 'found:', restored.length);

      if (restored.length > 0) {
        const [first, ...rest] = restored;
        setActiveRequest(first);
        setPendingRequests(rest);
      } else {
        setActiveRequest(null);
        setPendingRequests([]);
      }

      setIsRestoring(false);
    }
  }, [currentSessionId]);

  // Add a new permission request to the queue
  const enqueueRequest = useCallback((request) => {
    const toolKey = `${request.tool}:${request.operation || 'default'}`;

    console.log('🔐 [Permission] Enqueue request:', {
      id: request.id,
      tool: request.tool,
      operation: request.operation,
      toolKey,
      timestamp: new Date(request.timestamp).toISOString()
    });

    // Check if this tool has permanent permission
    if (permanentPermissions.has(toolKey)) {
      const decision = permanentPermissions.get(toolKey);
      console.log('✅ [Permission] Auto-approved (PERMANENT):', {
        toolKey,
        decision,
        storedCount: permanentPermissions.size,
        allPermanent: Array.from(permanentPermissions.keys())
      });
      return { autoApproved: true, decision };
    }

    // Check if this tool has session permission
    if (sessionPermissions.has(toolKey)) {
      const decision = sessionPermissions.get(toolKey);
      console.log('✅ [Permission] Auto-approved (SESSION):', {
        toolKey,
        decision,
        storedCount: sessionPermissions.size,
        allSession: Array.from(sessionPermissions.keys())
      });
      return { autoApproved: true, decision };
    }

    console.log('📋 [Permission] Queuing for user approval:', {
      toolKey,
      hasActiveRequest: !!activeRequest,
      queueLength: pendingRequests.length
    });

    const requestWithTimestamp = { ...request, timestamp: request.timestamp || Date.now() };

    // Persist to sessionStorage
    if (currentSessionId) {
      savePendingRequest(currentSessionId, requestWithTimestamp);
    }

    // If no active request, set this as active
    if (!activeRequest) {
      setActiveRequest(requestWithTimestamp);
    } else {
      // Otherwise add to pending requests queue
      setPendingRequests(prev => [...prev, requestWithTimestamp]);
    }

    return { autoApproved: false };
  }, [activeRequest, permanentPermissions, sessionPermissions, currentSessionId]);

  // Remove a request from the queue
  const dequeueRequest = useCallback((requestId) => {
    // Remove from sessionStorage
    if (currentSessionId) {
      removeFromStorage(currentSessionId, requestId);
    }

    setPendingRequests(prev => prev.filter(req => req.id !== requestId));

    // If this was the active request, move to next in queue
    if (activeRequest?.id === requestId) {
      setPendingRequests(prev => {
        const [next, ...remaining] = prev;
        setActiveRequest(next || null);
        return next ? remaining : prev;
      });
    }
  }, [activeRequest, currentSessionId]);

  // Handle user decision on a permission request
  const handleDecision = useCallback((requestId, decision, updatedInput = null) => {
    const request = activeRequest?.id === requestId
      ? activeRequest
      : pendingRequests.find(req => req.id === requestId);

    if (!request) {
      console.error('❌ [Permission] Request not found:', requestId);
      return null;
    }

    const toolKey = `${request.tool}:${request.operation || 'default'}`;

    console.log('👤 [Permission] User decision:', {
      requestId,
      toolKey,
      decision,
      hasUpdatedInput: !!updatedInput
    });

    // Add to history
    setPermissionHistory(prev => [...prev, {
      ...request,
      decision,
      decidedAt: Date.now(),
      updatedInput
    }]);

    // Handle session and permanent permissions
    if (decision === PERMISSION_DECISIONS.ALLOW_SESSION) {
      console.log('💾 [Permission] Storing SESSION permission:', toolKey);
      setSessionPermissions(prev => new Map(prev).set(toolKey, PERMISSION_DECISIONS.ALLOW));
    } else if (decision === PERMISSION_DECISIONS.ALLOW_ALWAYS) {
      console.log('💾 [Permission] Storing PERMANENT permission:', toolKey);
      setPermanentPermissions(prev => new Map(prev).set(toolKey, PERMISSION_DECISIONS.ALLOW));
    } else if (decision === 'never') {
      console.log('💾 [Permission] Storing PERMANENT deny:', toolKey);
      setPermanentPermissions(prev => new Map(prev).set(toolKey, PERMISSION_DECISIONS.DENY));
    }

    // Remove from queue
    dequeueRequest(requestId);

    return {
      id: requestId,
      decision,
      updatedInput
    };
  }, [activeRequest, pendingRequests, dequeueRequest]);

  // Clear all pending requests
  const clearAllRequests = useCallback(() => {
    if (currentSessionId) {
      clearStorage(currentSessionId);
    }
    setPendingRequests([]);
    setActiveRequest(null);
  }, [currentSessionId]);

  // Handle batch operations
  const handleBatchDecision = useCallback((requestIds, decision) => {
    const results = [];
    for (const id of requestIds) {
      const result = handleDecision(id, decision);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }, [handleDecision]);

  // Move to next request in queue
  const moveToNextRequest = useCallback(() => {
    if (pendingRequests.length > 0) {
      const [next, ...remaining] = pendingRequests;
      setActiveRequest(next);
      setPendingRequests(remaining);
    } else {
      setActiveRequest(null);
    }
  }, [pendingRequests]);

  // Move to a specific request in queue
  const jumpToRequest = useCallback((requestId) => {
    const request = pendingRequests.find(req => req.id === requestId);
    if (request) {
      setActiveRequest(request);
      setPendingRequests(prev => prev.filter(req => req.id !== requestId));
    }
  }, [pendingRequests]);

  // Clear session permissions
  const clearSessionPermissions = useCallback(() => {
    setSessionPermissions(new Map());
  }, []);

  // Clear permanent permissions for a specific tool
  const clearPermanentPermission = useCallback((toolKey) => {
    setPermanentPermissions(prev => {
      const updated = new Map(prev);
      updated.delete(toolKey);
      return updated;
    });
  }, []);

  // Get queue count
  const queueCount = pendingRequests.length + (activeRequest ? 1 : 0);

  const value = {
    // State
    pendingRequests,
    activeRequest,
    permissionHistory,
    sessionPermissions,
    permanentPermissions,
    queueCount,
    isRestoring,
    currentSessionId,

    // Actions
    enqueueRequest,
    dequeueRequest,
    handleDecision,
    clearAllRequests,
    handleBatchDecision,
    moveToNextRequest,
    jumpToRequest,
    clearSessionPermissions,
    clearPermanentPermission,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
};

export default PermissionContext;