import { 
  ERROR_CATEGORIES, 
  ERROR_RECOVERY_STRATEGIES, 
  classifyError 
} from './errorClassification';

import { generateUserFriendlyMessage } from './errorMessages';

/**
 * Error Recovery Workflows Service
 * Implements automated and manual error recovery strategies
 */

export const RECOVERY_ACTIONS = {
  RETRY: 'retry',
  FALLBACK: 'fallback',
  ROLLBACK: 'rollback',
  BROWSE_AGAIN: 'browse_again',
  CANCEL: 'cancel',
  IGNORE: 'ignore',
  ELEVATE_PERMISSIONS: 'elevate_permissions',
  CHECK_CONNECTION: 'check_connection',
  RESET_CONFIG: 'reset_config',
  REFRESH_PROJECT: 'refresh_project',
  CLEAR_CACHE: 'clear_cache',
  RESTART_SERVICE: 'restart_service',
  MANUAL_FIX: 'manual_fix',
  REPORT_ISSUE: 'report_issue'
};

export const RECOVERY_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  MANUAL_REQUIRED: 'manual_required'
};

class ErrorRecoveryService {
  constructor() {
    this.activeRecoveries = new Map();
    this.recoveryHistory = [];
    this.recoveryStrategies = new Map();
    this.maxRetryAttempts = 3;
    this.retryDelay = 1000;
    this.progressCallbacks = new Map();
    
    this.initializeRecoveryStrategies();
  }

  /**
   * Initialize recovery strategies for different error categories
   */
  initializeRecoveryStrategies() {
    // Path errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.PATH_ERROR, [
      {
        action: RECOVERY_ACTIONS.BROWSE_AGAIN,
        name: 'Browse Again',
        description: 'Open file browser to select correct path',
        automated: false,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.RETRY,
        name: 'Retry',
        description: 'Try the operation again',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Use Default',
        description: 'Use default path or location',
        automated: true,
        priority: 3
      }
    ]);

    // Permission errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.PERMISSION_ERROR, [
      {
        action: RECOVERY_ACTIONS.ELEVATE_PERMISSIONS,
        name: 'Elevate Permissions',
        description: 'Request administrator privileges',
        automated: false,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Use Alternative',
        description: 'Try alternative location or method',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.MANUAL_FIX,
        name: 'Manual Fix',
        description: 'Manually adjust permissions',
        automated: false,
        priority: 3
      }
    ]);

    // Network errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.NETWORK_ERROR, [
      {
        action: RECOVERY_ACTIONS.CHECK_CONNECTION,
        name: 'Check Connection',
        description: 'Test network connectivity',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.RETRY,
        name: 'Retry',
        description: 'Retry network operation',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Offline Mode',
        description: 'Continue in offline mode',
        automated: false,
        priority: 3
      }
    ]);

    // Timeout errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.TIMEOUT_ERROR, [
      {
        action: RECOVERY_ACTIONS.RETRY,
        name: 'Retry',
        description: 'Retry with longer timeout',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Reduce Scope',
        description: 'Try with smaller operation',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.CANCEL,
        name: 'Cancel',
        description: 'Cancel the operation',
        automated: false,
        priority: 3
      }
    ]);

    // Configuration errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.CONFIGURATION_ERROR, [
      {
        action: RECOVERY_ACTIONS.RESET_CONFIG,
        name: 'Reset Configuration',
        description: 'Reset to default settings',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Use Backup',
        description: 'Restore from backup configuration',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.MANUAL_FIX,
        name: 'Manual Edit',
        description: 'Manually edit configuration',
        automated: false,
        priority: 3
      }
    ]);

    // Project errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.PROJECT_ERROR, [
      {
        action: RECOVERY_ACTIONS.REFRESH_PROJECT,
        name: 'Refresh Project',
        description: 'Refresh project state',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.ROLLBACK,
        name: 'Rollback',
        description: 'Revert to previous state',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.RESTART_SERVICE,
        name: 'Restart Service',
        description: 'Restart project services',
        automated: true,
        priority: 3
      }
    ]);

    // System errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.SYSTEM_ERROR, [
      {
        action: RECOVERY_ACTIONS.CLEAR_CACHE,
        name: 'Clear Cache',
        description: 'Clear system cache',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.RESTART_SERVICE,
        name: 'Restart Service',
        description: 'Restart system services',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.MANUAL_FIX,
        name: 'Manual Intervention',
        description: 'Requires manual system intervention',
        automated: false,
        priority: 3
      }
    ]);

    // Process errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.PROCESS_ERROR, [
      {
        action: RECOVERY_ACTIONS.RETRY,
        name: 'Retry',
        description: 'Retry process execution',
        automated: true,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Alternative Method',
        description: 'Use alternative process',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.MANUAL_FIX,
        name: 'Manual Fix',
        description: 'Manually resolve process issue',
        automated: false,
        priority: 3
      }
    ]);

    // Validation errors
    this.recoveryStrategies.set(ERROR_CATEGORIES.VALIDATION_ERROR, [
      {
        action: RECOVERY_ACTIONS.MANUAL_FIX,
        name: 'Correct Input',
        description: 'Correct the input values',
        automated: false,
        priority: 1
      },
      {
        action: RECOVERY_ACTIONS.FALLBACK,
        name: 'Use Default',
        description: 'Use default values',
        automated: true,
        priority: 2
      },
      {
        action: RECOVERY_ACTIONS.IGNORE,
        name: 'Skip Validation',
        description: 'Skip validation (if safe)',
        automated: false,
        priority: 3
      }
    ]);
  }

  /**
   * Start recovery process for an error
   */
  async startRecovery(error, context = {}) {
    const classifiedError = classifyError(error);
    const friendlyMessage = generateUserFriendlyMessage(classifiedError);
    
    const recoveryId = this.generateRecoveryId();
    const recoverySession = {
      id: recoveryId,
      error: classifiedError,
      friendlyMessage,
      context,
      status: RECOVERY_STATUS.PENDING,
      attempts: 0,
      maxAttempts: this.maxRetryAttempts,
      startTime: Date.now(),
      strategies: this.getRecoveryStrategies(classifiedError.category),
      currentStrategy: null,
      progress: 0,
      log: []
    };

    this.activeRecoveries.set(recoveryId, recoverySession);
    this.logRecoveryEvent(recoveryId, 'Recovery session started');

    return {
      recoveryId,
      strategies: recoverySession.strategies,
      friendlyMessage,
      canAutoRecover: this.canAutoRecover(classifiedError)
    };
  }

  /**
   * Execute recovery action
   */
  async executeRecoveryAction(recoveryId, action, options = {}) {
    const session = this.activeRecoveries.get(recoveryId);
    if (!session) {
      throw new Error('Recovery session not found');
    }

    const strategy = session.strategies.find(s => s.action === action);
    if (!strategy) {
      throw new Error('Recovery strategy not found');
    }

    session.status = RECOVERY_STATUS.IN_PROGRESS;
    session.currentStrategy = strategy;
    session.attempts++;
    
    this.logRecoveryEvent(recoveryId, `Executing ${strategy.name}`);
    this.updateProgress(recoveryId, 10);

    try {
      const result = await this.executeStrategy(strategy, session, options);
      
      if (result.success) {
        session.status = RECOVERY_STATUS.SUCCESS;
        session.progress = 100;
        this.logRecoveryEvent(recoveryId, `Recovery successful: ${result.message}`);
        this.completeRecovery(recoveryId);
        return result;
      } else {
        this.logRecoveryEvent(recoveryId, `Recovery failed: ${result.message}`);
        
        // Try next strategy if available
        if (session.attempts < session.maxAttempts) {
          const nextStrategy = this.getNextStrategy(session);
          if (nextStrategy) {
            return this.executeRecoveryAction(recoveryId, nextStrategy.action, options);
          }
        }
        
        session.status = RECOVERY_STATUS.FAILED;
        return result;
      }
    } catch (error) {
      session.status = RECOVERY_STATUS.FAILED;
      this.logRecoveryEvent(recoveryId, `Recovery error: ${error.message}`);
      return {
        success: false,
        message: error.message,
        requiresManualIntervention: true
      };
    }
  }

  /**
   * Execute specific recovery strategy
   */
  async executeStrategy(strategy, session, options) {
    const { action } = strategy;
    const { error, context } = session;

    this.updateProgress(session.id, 30);

    switch (action) {
      case RECOVERY_ACTIONS.RETRY:
        return this.executeRetry(session, options);
        
      case RECOVERY_ACTIONS.FALLBACK:
        return this.executeFallback(session, options);
        
      case RECOVERY_ACTIONS.ROLLBACK:
        return this.executeRollback(session, options);
        
      case RECOVERY_ACTIONS.BROWSE_AGAIN:
        return this.executeBrowseAgain(session, options);
        
      case RECOVERY_ACTIONS.CHECK_CONNECTION:
        return this.executeCheckConnection(session, options);
        
      case RECOVERY_ACTIONS.RESET_CONFIG:
        return this.executeResetConfig(session, options);
        
      case RECOVERY_ACTIONS.REFRESH_PROJECT:
        return this.executeRefreshProject(session, options);
        
      case RECOVERY_ACTIONS.CLEAR_CACHE:
        return this.executeClearCache(session, options);
        
      case RECOVERY_ACTIONS.RESTART_SERVICE:
        return this.executeRestartService(session, options);
        
      case RECOVERY_ACTIONS.ELEVATE_PERMISSIONS:
        return this.executeElevatePermissions(session, options);
        
      case RECOVERY_ACTIONS.MANUAL_FIX:
        return this.executeManualFix(session, options);
        
      case RECOVERY_ACTIONS.IGNORE:
        return this.executeIgnore(session, options);
        
      case RECOVERY_ACTIONS.CANCEL:
        return this.executeCancel(session, options);
        
      default:
        throw new Error(`Unknown recovery action: ${action}`);
    }
  }

  /**
   * Retry strategy implementation
   */
  async executeRetry(session, options) {
    const { retryCallback, retryDelay = this.retryDelay } = options;
    
    this.updateProgress(session.id, 50);
    
    if (retryCallback) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      this.updateProgress(session.id, 80);
      
      try {
        const result = await retryCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Retry successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Retry failed: ${error.message}`,
          canRetry: session.attempts < session.maxAttempts
        };
      }
    }
    
    return {
      success: false,
      message: 'No retry callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Fallback strategy implementation
   */
  async executeFallback(session, options) {
    const { fallbackCallback, fallbackValue } = options;
    
    this.updateProgress(session.id, 70);
    
    if (fallbackCallback) {
      try {
        const result = await fallbackCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Fallback successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Fallback failed: ${error.message}`
        };
      }
    }
    
    if (fallbackValue !== undefined) {
      this.updateProgress(session.id, 100);
      return {
        success: true,
        message: 'Using fallback value',
        data: fallbackValue
      };
    }
    
    return {
      success: false,
      message: 'No fallback option provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Rollback strategy implementation
   */
  async executeRollback(session, options) {
    const { rollbackCallback, stateSnapshot } = options;
    
    this.updateProgress(session.id, 60);
    
    if (rollbackCallback) {
      try {
        const result = await rollbackCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Rollback successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Rollback failed: ${error.message}`
        };
      }
    }
    
    return {
      success: false,
      message: 'No rollback callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Browse again strategy implementation
   */
  async executeBrowseAgain(session, options) {
    const { onBrowseRequest } = options;
    
    if (onBrowseRequest) {
      onBrowseRequest({
        error: session.error,
        context: session.context,
        recoveryId: session.id
      });
      
      return {
        success: true,
        message: 'File browser opened',
        requiresUserAction: true
      };
    }
    
    return {
      success: false,
      message: 'No browse callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Check connection strategy implementation
   */
  async executeCheckConnection(session, options) {
    const { connectionTestCallback } = options;
    
    this.updateProgress(session.id, 40);
    
    if (connectionTestCallback) {
      try {
        const isConnected = await connectionTestCallback();
        this.updateProgress(session.id, 100);
        
        if (isConnected) {
          return {
            success: true,
            message: 'Connection test successful',
            data: { connected: true }
          };
        } else {
          return {
            success: false,
            message: 'Connection test failed',
            data: { connected: false }
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Connection test error: ${error.message}`
        };
      }
    }
    
    // Default connection test
    try {
      const response = await fetch('/api/health', { timeout: 5000 });
      const isConnected = response.ok;
      this.updateProgress(session.id, 100);
      
      return {
        success: isConnected,
        message: isConnected ? 'Connection test successful' : 'Connection test failed',
        data: { connected: isConnected }
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection test failed: ${error.message}`
      };
    }
  }

  /**
   * Reset configuration strategy implementation
   */
  async executeResetConfig(session, options) {
    const { configResetCallback } = options;
    
    this.updateProgress(session.id, 50);
    
    if (configResetCallback) {
      try {
        const result = await configResetCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Configuration reset successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Configuration reset failed: ${error.message}`
        };
      }
    }
    
    return {
      success: false,
      message: 'No configuration reset callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Refresh project strategy implementation
   */
  async executeRefreshProject(session, options) {
    const { projectRefreshCallback } = options;
    
    this.updateProgress(session.id, 60);
    
    if (projectRefreshCallback) {
      try {
        const result = await projectRefreshCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Project refresh successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Project refresh failed: ${error.message}`
        };
      }
    }
    
    // Default project refresh
    try {
      if (typeof window !== 'undefined' && window.refreshProjects) {
        await window.refreshProjects();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Project refresh successful'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Project refresh failed: ${error.message}`
      };
    }
    
    return {
      success: false,
      message: 'No project refresh callback available',
      requiresManualIntervention: true
    };
  }

  /**
   * Clear cache strategy implementation
   */
  async executeClearCache(session, options) {
    const { cacheKeys = [] } = options;
    
    this.updateProgress(session.id, 40);
    
    try {
      // Clear localStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        if (cacheKeys.length > 0) {
          cacheKeys.forEach(key => localStorage.removeItem(key));
        } else {
          // Clear all localStorage
          localStorage.clear();
        }
      }
      
      // Clear sessionStorage
      if (typeof window !== 'undefined' && window.sessionStorage) {
        sessionStorage.clear();
      }
      
      this.updateProgress(session.id, 100);
      return {
        success: true,
        message: 'Cache cleared successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Cache clear failed: ${error.message}`
      };
    }
  }

  /**
   * Restart service strategy implementation
   */
  async executeRestartService(session, options) {
    const { serviceRestartCallback } = options;
    
    this.updateProgress(session.id, 50);
    
    if (serviceRestartCallback) {
      try {
        const result = await serviceRestartCallback();
        this.updateProgress(session.id, 100);
        return {
          success: true,
          message: 'Service restart successful',
          data: result
        };
      } catch (error) {
        return {
          success: false,
          message: `Service restart failed: ${error.message}`
        };
      }
    }
    
    return {
      success: false,
      message: 'No service restart callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Elevate permissions strategy implementation
   */
  async executeElevatePermissions(session, options) {
    const { onPermissionRequest } = options;
    
    if (onPermissionRequest) {
      onPermissionRequest({
        error: session.error,
        context: session.context,
        recoveryId: session.id
      });
      
      return {
        success: true,
        message: 'Permission elevation requested',
        requiresUserAction: true
      };
    }
    
    return {
      success: false,
      message: 'No permission elevation callback provided',
      requiresManualIntervention: true
    };
  }

  /**
   * Manual fix strategy implementation
   */
  async executeManualFix(session, options) {
    return {
      success: false,
      message: 'Manual intervention required',
      requiresManualIntervention: true,
      instructions: this.getManualFixInstructions(session.error.category)
    };
  }

  /**
   * Ignore strategy implementation
   */
  async executeIgnore(session, options) {
    this.updateProgress(session.id, 100);
    return {
      success: true,
      message: 'Error ignored',
      data: { ignored: true }
    };
  }

  /**
   * Cancel strategy implementation
   */
  async executeCancel(session, options) {
    session.status = RECOVERY_STATUS.CANCELLED;
    this.updateProgress(session.id, 0);
    return {
      success: true,
      message: 'Operation cancelled',
      data: { cancelled: true }
    };
  }

  /**
   * Get recovery strategies for error category
   */
  getRecoveryStrategies(category) {
    return this.recoveryStrategies.get(category) || [];
  }

  /**
   * Get next recovery strategy
   */
  getNextStrategy(session) {
    const currentIndex = session.strategies.findIndex(s => s.action === session.currentStrategy?.action);
    return session.strategies[currentIndex + 1] || null;
  }

  /**
   * Check if error can be auto-recovered
   */
  canAutoRecover(classifiedError) {
    const strategies = this.getRecoveryStrategies(classifiedError.category);
    return strategies.some(s => s.automated);
  }

  /**
   * Get manual fix instructions
   */
  getManualFixInstructions(category) {
    const instructions = {
      [ERROR_CATEGORIES.PATH_ERROR]: [
        'Verify the file or directory exists',
        'Check the path spelling and format',
        'Ensure you have access to the location',
        'Try using an absolute path instead of relative'
      ],
      [ERROR_CATEGORIES.PERMISSION_ERROR]: [
        'Check file/directory permissions',
        'Run the application as administrator',
        'Verify user account has necessary privileges',
        'Contact system administrator if needed'
      ],
      [ERROR_CATEGORIES.NETWORK_ERROR]: [
        'Check internet connection',
        'Verify network settings',
        'Check firewall and proxy settings',
        'Try connecting to a different network'
      ],
      [ERROR_CATEGORIES.CONFIGURATION_ERROR]: [
        'Review configuration file syntax',
        'Check for missing or invalid settings',
        'Restore from backup if available',
        'Reset to default configuration'
      ]
    };
    
    return instructions[category] || ['Contact support for assistance'];
  }

  /**
   * Update recovery progress
   */
  updateProgress(recoveryId, progress) {
    const session = this.activeRecoveries.get(recoveryId);
    if (session) {
      session.progress = progress;
      const callback = this.progressCallbacks.get(recoveryId);
      if (callback) {
        callback(progress);
      }
    }
  }

  /**
   * Set progress callback
   */
  setProgressCallback(recoveryId, callback) {
    this.progressCallbacks.set(recoveryId, callback);
  }

  /**
   * Log recovery event
   */
  logRecoveryEvent(recoveryId, message) {
    const session = this.activeRecoveries.get(recoveryId);
    if (session) {
      session.log.push({
        timestamp: new Date().toISOString(),
        message
      });
    }
  }

  /**
   * Complete recovery
   */
  completeRecovery(recoveryId) {
    const session = this.activeRecoveries.get(recoveryId);
    if (session) {
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;
      
      // Move to history
      this.recoveryHistory.push(session);
      
      // Clean up active recovery
      this.activeRecoveries.delete(recoveryId);
      this.progressCallbacks.delete(recoveryId);
      
      this.logRecoveryEvent(recoveryId, 'Recovery completed');
    }
  }

  /**
   * Cancel recovery
   */
  cancelRecovery(recoveryId) {
    const session = this.activeRecoveries.get(recoveryId);
    if (session) {
      session.status = RECOVERY_STATUS.CANCELLED;
      this.completeRecovery(recoveryId);
    }
  }

  /**
   * Get recovery session
   */
  getRecoverySession(recoveryId) {
    return this.activeRecoveries.get(recoveryId);
  }

  /**
   * Get recovery history
   */
  getRecoveryHistory() {
    return this.recoveryHistory;
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStatistics() {
    const total = this.recoveryHistory.length;
    const successful = this.recoveryHistory.filter(r => r.status === RECOVERY_STATUS.SUCCESS).length;
    const failed = this.recoveryHistory.filter(r => r.status === RECOVERY_STATUS.FAILED).length;
    const cancelled = this.recoveryHistory.filter(r => r.status === RECOVERY_STATUS.CANCELLED).length;
    
    return {
      total,
      successful,
      failed,
      cancelled,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      averageDuration: this.calculateAverageDuration()
    };
  }

  /**
   * Calculate average recovery duration
   */
  calculateAverageDuration() {
    const completedRecoveries = this.recoveryHistory.filter(r => r.duration);
    if (completedRecoveries.length === 0) return 0;
    
    const totalDuration = completedRecoveries.reduce((sum, r) => sum + r.duration, 0);
    return totalDuration / completedRecoveries.length;
  }

  /**
   * Generate recovery ID
   */
  generateRecoveryId() {
    return `recovery_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

// Export singleton instance
export const errorRecoveryService = new ErrorRecoveryService();

// Export recovery workflow hooks
export function useErrorRecovery() {
  return {
    startRecovery: (error, context) => errorRecoveryService.startRecovery(error, context),
    executeRecovery: (recoveryId, action, options) => errorRecoveryService.executeRecoveryAction(recoveryId, action, options),
    cancelRecovery: (recoveryId) => errorRecoveryService.cancelRecovery(recoveryId),
    getRecoverySession: (recoveryId) => errorRecoveryService.getRecoverySession(recoveryId),
    setProgressCallback: (recoveryId, callback) => errorRecoveryService.setProgressCallback(recoveryId, callback),
    getStatistics: () => errorRecoveryService.getRecoveryStatistics()
  };
}

export default errorRecoveryService;