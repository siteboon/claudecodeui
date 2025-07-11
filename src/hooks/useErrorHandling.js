import { useState, useCallback, useEffect } from 'react';
import { classifyError } from '../services/errorClassification';
import { generateUserFriendlyMessage } from '../services/errorMessages';
import { useErrorRecovery } from '../services/errorRecovery';
import { useErrorLogging } from '../services/errorLogging';

/**
 * Comprehensive Error Handling Hook
 * Integrates classification, user-friendly messages, recovery workflows, and secure logging
 */
export function useErrorHandling(options = {}) {
  const {
    autoRecovery = true,
    logErrors = true,
    showNotifications = true,
    maxActiveErrors = 5,
    onError,
    onRecovery,
    onErrorResolved
  } = options;

  const [activeErrors, setActiveErrors] = useState([]);
  const [isProcessingError, setIsProcessingError] = useState(false);
  const [errorStats, setErrorStats] = useState({
    totalErrors: 0,
    resolvedErrors: 0,
    activeRecoveries: 0
  });

  const { 
    startRecovery, 
    executeRecovery, 
    cancelRecovery, 
    getRecoverySession,
    setProgressCallback,
    getStatistics: getRecoveryStats
  } = useErrorRecovery();

  const { logError, getStatistics: getLoggingStats } = useErrorLogging();

  /**
   * Handle error with full processing pipeline
   */
  const handleError = useCallback(async (error, context = {}) => {
    if (isProcessingError) return null;
    
    setIsProcessingError(true);

    try {
      // 1. Classify the error
      const classifiedError = classifyError(error);
      
      // 2. Generate user-friendly message
      const friendlyMessage = generateUserFriendlyMessage(classifiedError);
      
      // 3. Log the error securely
      let logId = null;
      if (logErrors) {
        logId = logError(error, {
          ...context,
          errorId: friendlyMessage.id,
          classification: classifiedError
        });
      }

      // 4. Create error state object
      const errorState = {
        id: friendlyMessage.id,
        originalError: error,
        classifiedError,
        friendlyMessage,
        context,
        logId,
        timestamp: new Date().toISOString(),
        status: 'active',
        recoveryId: null,
        recoveryProgress: 0,
        actions: friendlyMessage.actions
      };

      // 5. Add to active errors (with limit)
      setActiveErrors(prev => {
        const updated = [errorState, ...prev];
        return updated.slice(0, maxActiveErrors);
      });

      // 6. Update statistics
      setErrorStats(prev => ({
        ...prev,
        totalErrors: prev.totalErrors + 1
      }));

      // 7. Trigger callback
      if (onError) {
        onError(errorState);
      }

      // 8. Start auto-recovery if enabled and applicable
      if (autoRecovery && classifiedError.recoveryStrategy !== 'manual') {
        try {
          const recoveryResult = await startRecovery(error, context);
          if (recoveryResult.canAutoRecover) {
            errorState.recoveryId = recoveryResult.recoveryId;
            
            // Set up progress callback
            setProgressCallback(recoveryResult.recoveryId, (progress) => {
              setActiveErrors(prev => 
                prev.map(err => 
                  err.id === errorState.id 
                    ? { ...err, recoveryProgress: progress }
                    : err
                )
              );
            });

            // Update statistics
            setErrorStats(prev => ({
              ...prev,
              activeRecoveries: prev.activeRecoveries + 1
            }));
          }
        } catch (recoveryError) {
          console.warn('Auto-recovery failed to start:', recoveryError);
        }
      }

      return errorState;

    } finally {
      setIsProcessingError(false);
    }
  }, [
    isProcessingError,
    logErrors,
    maxActiveErrors,
    autoRecovery,
    onError,
    logError,
    startRecovery,
    setProgressCallback
  ]);

  /**
   * Execute error action (retry, fallback, etc.)
   */
  const executeErrorAction = useCallback(async (errorId, action, options = {}) => {
    const errorState = activeErrors.find(err => err.id === errorId);
    if (!errorState) {
      throw new Error('Error not found');
    }

    try {
      if (action.type === 'dismiss') {
        // Simply remove the error
        setActiveErrors(prev => prev.filter(err => err.id !== errorId));
        setErrorStats(prev => ({
          ...prev,
          resolvedErrors: prev.resolvedErrors + 1
        }));
        
        if (onErrorResolved) {
          onErrorResolved(errorState, { action: 'dismissed' });
        }
        return { success: true };
      }

      if (action.type === 'report') {
        // Generate error report
        const report = {
          errorId,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href,
          errorDetails: errorState.friendlyMessage,
          context: errorState.context
        };
        
        // Copy to clipboard or trigger download
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
        }
        
        return { success: true, message: 'Error report copied to clipboard' };
      }

      // Recovery actions
      if (errorState.recoveryId) {
        const result = await executeRecovery(errorState.recoveryId, action.type, options);
        
        if (result.success) {
          // Mark error as resolved
          setActiveErrors(prev => 
            prev.map(err => 
              err.id === errorId 
                ? { ...err, status: 'resolved', recoveryResult: result }
                : err
            )
          );
          
          setErrorStats(prev => ({
            ...prev,
            resolvedErrors: prev.resolvedErrors + 1,
            activeRecoveries: Math.max(0, prev.activeRecoveries - 1)
          }));

          if (onRecovery) {
            onRecovery(errorState, result);
          }

          if (onErrorResolved) {
            onErrorResolved(errorState, result);
          }
        }
        
        return result;
      } else {
        // Start new recovery for manual actions
        const recoveryResult = await startRecovery(errorState.originalError, errorState.context);
        const result = await executeRecovery(recoveryResult.recoveryId, action.type, options);
        
        return result;
      }
    } catch (error) {
      console.error('Error action execution failed:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }, [
    activeErrors,
    executeRecovery,
    startRecovery,
    onRecovery,
    onErrorResolved
  ]);

  /**
   * Dismiss error
   */
  const dismissError = useCallback((errorId) => {
    setActiveErrors(prev => prev.filter(err => err.id !== errorId));
    setErrorStats(prev => ({
      ...prev,
      resolvedErrors: prev.resolvedErrors + 1
    }));
  }, []);

  /**
   * Dismiss all errors
   */
  const dismissAllErrors = useCallback(() => {
    const count = activeErrors.length;
    setActiveErrors([]);
    setErrorStats(prev => ({
      ...prev,
      resolvedErrors: prev.resolvedErrors + count
    }));
  }, [activeErrors.length]);

  /**
   * Cancel recovery
   */
  const cancelErrorRecovery = useCallback((errorId) => {
    const errorState = activeErrors.find(err => err.id === errorId);
    if (errorState?.recoveryId) {
      cancelRecovery(errorState.recoveryId);
      
      setActiveErrors(prev => 
        prev.map(err => 
          err.id === errorId 
            ? { ...err, status: 'recovery_cancelled', recoveryId: null }
            : err
        )
      );
      
      setErrorStats(prev => ({
        ...prev,
        activeRecoveries: Math.max(0, prev.activeRecoveries - 1)
      }));
    }
  }, [activeErrors, cancelRecovery]);

  /**
   * Get error by ID
   */
  const getError = useCallback((errorId) => {
    return activeErrors.find(err => err.id === errorId);
  }, [activeErrors]);

  /**
   * Get filtered errors
   */
  const getErrors = useCallback((filters = {}) => {
    let filtered = [...activeErrors];
    
    if (filters.status) {
      filtered = filtered.filter(err => err.status === filters.status);
    }
    
    if (filters.category) {
      filtered = filtered.filter(err => 
        err.classifiedError.category === filters.category
      );
    }
    
    if (filters.severity) {
      filtered = filtered.filter(err => 
        err.classifiedError.severity === filters.severity
      );
    }
    
    return filtered;
  }, [activeErrors]);

  /**
   * Get comprehensive statistics
   */
  const getComprehensiveStats = useCallback(() => {
    const recoveryStats = getRecoveryStats();
    const loggingStats = getLoggingStats();
    
    return {
      errors: errorStats,
      recovery: recoveryStats,
      logging: loggingStats,
      active: {
        totalActiveErrors: activeErrors.length,
        byCategory: activeErrors.reduce((acc, err) => {
          const category = err.classifiedError.category;
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        }, {}),
        bySeverity: activeErrors.reduce((acc, err) => {
          const severity = err.classifiedError.severity;
          acc[severity] = (acc[severity] || 0) + 1;
          return acc;
        }, {}),
        activeRecoveries: activeErrors.filter(err => err.recoveryId).length
      }
    };
  }, [errorStats, activeErrors, getRecoveryStats, getLoggingStats]);

  /**
   * Cleanup resolved errors periodically
   */
  useEffect(() => {
    const cleanup = setInterval(() => {
      setActiveErrors(prev => 
        prev.filter(err => {
          const age = Date.now() - new Date(err.timestamp).getTime();
          const maxAge = 5 * 60 * 1000; // 5 minutes
          
          // Keep active errors and recent resolved errors
          return err.status === 'active' || age < maxAge;
        })
      );
    }, 60000); // Check every minute

    return () => clearInterval(cleanup);
  }, []);

  return {
    // Core functions
    handleError,
    executeErrorAction,
    dismissError,
    dismissAllErrors,
    cancelErrorRecovery,
    
    // Data access
    activeErrors,
    getError,
    getErrors,
    
    // State
    isProcessingError,
    errorStats,
    hasActiveErrors: activeErrors.length > 0,
    hasActiveRecoveries: activeErrors.some(err => err.recoveryId),
    
    // Statistics
    getComprehensiveStats,
    
    // Utilities
    classifyError,
    generateUserFriendlyMessage
  };
}

/**
 * Simplified error handling hook for basic usage
 */
export function useSimpleErrorHandling() {
  const { handleError, activeErrors, dismissError, executeErrorAction } = useErrorHandling();
  
  return {
    handleError,
    errors: activeErrors,
    dismissError,
    executeAction: executeErrorAction,
    hasErrors: activeErrors.length > 0
  };
}

/**
 * Hook for error notifications
 */
export function useErrorNotifications(options = {}) {
  const { duration = 5000, position = 'top-right' } = options;
  const [notifications, setNotifications] = useState([]);
  
  const showErrorNotification = useCallback((errorState) => {
    const notification = {
      id: errorState.id,
      title: errorState.friendlyMessage.title,
      message: errorState.friendlyMessage.message,
      severity: errorState.classifiedError.severity,
      timestamp: Date.now(),
      dismissed: false
    };
    
    setNotifications(prev => [notification, ...prev.slice(0, 4)]); // Max 5 notifications
    
    // Auto-dismiss
    setTimeout(() => {
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notification.id 
            ? { ...notif, dismissed: true }
            : notif
        )
      );
    }, duration);
  }, [duration]);
  
  const dismissNotification = useCallback((notificationId) => {
    setNotifications(prev => 
      prev.filter(notif => notif.id !== notificationId)
    );
  }, []);
  
  return {
    notifications: notifications.filter(n => !n.dismissed),
    showErrorNotification,
    dismissNotification
  };
}

export default useErrorHandling;