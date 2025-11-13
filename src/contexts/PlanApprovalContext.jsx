import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

const PlanApprovalContext = createContext();

export const usePlanApproval = () => {
  const context = useContext(PlanApprovalContext);
  if (!context) {
    throw new Error('usePlanApproval must be used within a PlanApprovalProvider');
  }
  return context;
};

export const PlanApprovalProvider = ({ children, websocket }) => {
  const [activePlan, setActivePlan] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!websocket) return;

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'plan-approval-request') {
          console.log('📋 [PlanApproval] Received plan approval request:', data.planId);
          setActivePlan({
            planId: data.planId,
            content: data.content,
            sessionId: data.sessionId,
            timestamp: data.timestamp,
            expiresAt: data.expiresAt
          });
        } else if (data.type === 'plan-approval-timeout') {
          console.log('⏱️  [PlanApproval] Plan approval timed out:', data.planId);
          if (activePlan && activePlan.planId === data.planId) {
            setActivePlan(null);
            setIsProcessing(false);
          }
        }
      } catch (error) {
        console.error('Error handling plan approval message:', error);
      }
    };

    websocket.addEventListener('message', handleMessage);

    return () => {
      websocket.removeEventListener('message', handleMessage);
    };
  }, [websocket, activePlan]);

  const handlePlanApproval = useCallback((planId, permissionMode) => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    console.log('✅ [PlanApproval] Approving plan:', { planId, permissionMode });
    setIsProcessing(true);

    const response = {
      type: 'plan-approval-response',
      planId,
      decision: 'approve',
      permissionMode,
      timestamp: Date.now()
    };

    websocket.send(JSON.stringify(response));

    setActivePlan(null);
    setTimeout(() => setIsProcessing(false), 1000);
  }, [websocket]);

  const handlePlanRejection = useCallback((planId, reason = 'User rejected the plan') => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    console.log('❌ [PlanApproval] Rejecting plan:', { planId, reason });
    setIsProcessing(true);

    const response = {
      type: 'plan-approval-response',
      planId,
      decision: 'reject',
      reason,
      timestamp: Date.now()
    };

    websocket.send(JSON.stringify(response));

    // Clear active plan
    setActivePlan(null);
    setTimeout(() => setIsProcessing(false), 1000);
  }, [websocket]);

  const value = {
    activePlan,
    isProcessing,
    handlePlanApproval,
    handlePlanRejection
  };

  return (
    <PlanApprovalContext.Provider value={value}>
      {children}
    </PlanApprovalContext.Provider>
  );
};
