import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { PERMISSION_DECISIONS, WS_MESSAGE_TYPES } from '../utils/permissionWebSocketClient';

const PermissionContext = createContext();

export const usePermission = () => {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermission must be used within a PermissionProvider');
  }
  return context;
};

export const PermissionProvider = ({ children }) => {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [permissionHistory, setPermissionHistory] = useState([]);
  const [sessionPermissions, setSessionPermissions] = useState(new Map());
  const [permanentPermissions, setPermanentPermissions] = useState(new Map());

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

  // Add a new permission request to the queue
  const enqueueRequest = useCallback((request) => {
    // Check if this tool has permanent permission
    const toolKey = `${request.tool}:${request.operation || 'default'}`;
    if (permanentPermissions.has(toolKey)) {
      const decision = permanentPermissions.get(toolKey);
      return { autoApproved: true, decision };
    }

    // Check if this tool has session permission
    if (sessionPermissions.has(toolKey)) {
      const decision = sessionPermissions.get(toolKey);
      return { autoApproved: true, decision };
    }

    // If no active request, set this as active
    if (!activeRequest) {
      setActiveRequest({ ...request, timestamp: request.timestamp || Date.now() });
    } else {
      // Otherwise add to pending requests queue
      setPendingRequests(prev => [...prev, { ...request, timestamp: request.timestamp || Date.now() }]);
    }

    return { autoApproved: false };
  }, [activeRequest, permanentPermissions, sessionPermissions]);

  // Remove a request from the queue
  const dequeueRequest = useCallback((requestId) => {
    setPendingRequests(prev => prev.filter(req => req.id !== requestId));

    // If this was the active request, move to next in queue
    if (activeRequest?.id === requestId) {
      setPendingRequests(prev => {
        const [next, ...remaining] = prev;
        setActiveRequest(next || null);
        return next ? remaining : prev;
      });
    }
  }, [activeRequest]);

  // Handle user decision on a permission request
  const handleDecision = useCallback((requestId, decision, updatedInput = null) => {
    const request = activeRequest?.id === requestId
      ? activeRequest
      : pendingRequests.find(req => req.id === requestId);

    if (!request) {
      console.error('Request not found:', requestId);
      return null;
    }

    // Add to history
    setPermissionHistory(prev => [...prev, {
      ...request,
      decision,
      decidedAt: Date.now(),
      updatedInput
    }]);

    // Handle session and permanent permissions
    const toolKey = `${request.tool}:${request.operation || 'default'}`;

    if (decision === PERMISSION_DECISIONS.ALLOW_SESSION) {
      setSessionPermissions(prev => new Map(prev).set(toolKey, PERMISSION_DECISIONS.ALLOW));
    } else if (decision === PERMISSION_DECISIONS.ALLOW_ALWAYS) {
      setPermanentPermissions(prev => new Map(prev).set(toolKey, PERMISSION_DECISIONS.ALLOW));
    } else if (decision === 'never') {
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
    setPendingRequests([]);
    setActiveRequest(null);
  }, []);

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