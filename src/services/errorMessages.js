import { 
  ERROR_CATEGORIES, 
  ERROR_SEVERITY, 
  ERROR_RECOVERY_STRATEGIES,
  getErrorCategoryInfo,
  getErrorSeverityInfo,
  getRecoveryStrategyInfo
} from './errorClassification';

/**
 * User-friendly error messages service
 * Converts technical errors into actionable user messages
 */

// User-friendly message templates
const ERROR_MESSAGE_TEMPLATES = {
  [ERROR_CATEGORIES.PATH_ERROR]: {
    title: 'Path Not Found',
    message: 'The file or folder you\'re trying to access doesn\'t exist or has been moved.',
    suggestions: [
      'Double-check the path is correct',
      'Verify the file or folder exists',
      'Check if you have the right permissions',
      'Try browsing to the location manually'
    ],
    icon: '📁'
  },
  
  [ERROR_CATEGORIES.PERMISSION_ERROR]: {
    title: 'Permission Denied',
    message: 'You don\'t have the necessary permissions to access this resource.',
    suggestions: [
      'Check your user permissions',
      'Try running as administrator/sudo',
      'Contact your system administrator',
      'Verify file/folder permissions'
    ],
    icon: '🔒'
  },
  
  [ERROR_CATEGORIES.NETWORK_ERROR]: {
    title: 'Network Connection Failed',
    message: 'Unable to connect to the server or network service.',
    suggestions: [
      'Check your internet connection',
      'Verify the server is running',
      'Try again in a few moments',
      'Check firewall settings'
    ],
    icon: '🌐'
  },
  
  [ERROR_CATEGORIES.TIMEOUT_ERROR]: {
    title: 'Operation Timed Out',
    message: 'The operation took too long to complete and was cancelled.',
    suggestions: [
      'Try the operation again',
      'Check your network connection',
      'Reduce the scope of the operation',
      'Contact support if problem persists'
    ],
    icon: '⏱️'
  },
  
  [ERROR_CATEGORIES.PROCESS_ERROR]: {
    title: 'Process Execution Failed',
    message: 'A required process or command failed to execute properly.',
    suggestions: [
      'Verify the command exists',
      'Check system requirements',
      'Try restarting the application',
      'Check for missing dependencies'
    ],
    icon: '⚙️'
  },
  
  [ERROR_CATEGORIES.CONFIGURATION_ERROR]: {
    title: 'Configuration Error',
    message: 'There\'s an issue with the application configuration.',
    suggestions: [
      'Check configuration file syntax',
      'Verify all required settings are present',
      'Try resetting to default configuration',
      'Check for typos in configuration values'
    ],
    icon: '🔧'
  },
  
  [ERROR_CATEGORIES.VALIDATION_ERROR]: {
    title: 'Invalid Input',
    message: 'The information you provided doesn\'t meet the required format.',
    suggestions: [
      'Check the format requirements',
      'Verify all required fields are filled',
      'Remove any invalid characters',
      'Follow the provided examples'
    ],
    icon: '✅'
  },
  
  [ERROR_CATEGORIES.SYSTEM_ERROR]: {
    title: 'System Error',
    message: 'A system-level error occurred that prevents normal operation.',
    suggestions: [
      'Restart the application',
      'Check available disk space',
      'Verify system resources',
      'Contact technical support'
    ],
    icon: '💾'
  },
  
  [ERROR_CATEGORIES.PROJECT_ERROR]: {
    title: 'Project Error',
    message: 'There\'s an issue with the current project configuration or state.',
    suggestions: [
      'Try refreshing the project',
      'Check project settings',
      'Verify project structure',
      'Consider re-initializing the project'
    ],
    icon: '📋'
  },
  
  [ERROR_CATEGORIES.UNKNOWN_ERROR]: {
    title: 'Unexpected Error',
    message: 'An unexpected error occurred that we couldn\'t identify.',
    suggestions: [
      'Try the operation again',
      'Restart the application',
      'Check for application updates',
      'Report this issue to support'
    ],
    icon: '❓'
  }
};

// Specific error message overrides for common errors
const SPECIFIC_ERROR_MESSAGES = {
  'ENOENT': {
    title: 'File Not Found',
    message: 'The requested file or directory could not be found.',
    suggestions: [
      'Verify the file path is correct',
      'Check if the file was moved or deleted',
      'Ensure you have access to the location',
      'Try browsing to the file manually'
    ]
  },
  
  'EACCES': {
    title: 'Access Denied',
    message: 'You don\'t have permission to access this file or directory.',
    suggestions: [
      'Check file permissions',
      'Try running with elevated privileges',
      'Contact your administrator',
      'Verify you own the file or directory'
    ]
  },
  
  'ECONNREFUSED': {
    title: 'Connection Refused',
    message: 'The server refused the connection attempt.',
    suggestions: [
      'Check if the server is running',
      'Verify the correct port is being used',
      'Check firewall settings',
      'Try connecting later'
    ]
  },
  
  'ETIMEDOUT': {
    title: 'Connection Timeout',
    message: 'The connection attempt timed out.',
    suggestions: [
      'Check your network connection',
      'Try again with a longer timeout',
      'Verify the server is responsive',
      'Check for network congestion'
    ]
  },
  
  'ENOSPC': {
    title: 'Disk Full',
    message: 'There\'s not enough disk space to complete the operation.',
    suggestions: [
      'Free up disk space',
      'Delete unnecessary files',
      'Move files to another location',
      'Check available storage'
    ]
  }
};

/**
 * Generate user-friendly error message from classified error
 */
export function generateUserFriendlyMessage(classifiedError) {
  const { category, severity, recoveryStrategy, originalError, errorId } = classifiedError;
  
  // Check for specific error message first
  const errorCode = originalError?.code || originalError?.errno;
  let messageTemplate;
  
  if (errorCode && SPECIFIC_ERROR_MESSAGES[errorCode]) {
    messageTemplate = SPECIFIC_ERROR_MESSAGES[errorCode];
  } else {
    messageTemplate = ERROR_MESSAGE_TEMPLATES[category] || ERROR_MESSAGE_TEMPLATES[ERROR_CATEGORIES.UNKNOWN_ERROR];
  }
  
  // Get additional context
  const categoryInfo = getErrorCategoryInfo(category);
  const severityInfo = getErrorSeverityInfo(severity);
  const recoveryInfo = getRecoveryStrategyInfo(recoveryStrategy);
  
  // Build the friendly message
  const friendlyMessage = {
    id: errorId,
    title: messageTemplate.title,
    message: messageTemplate.message,
    suggestions: messageTemplate.suggestions,
    icon: messageTemplate.icon,
    
    // Classification info
    category: {
      id: category,
      name: categoryInfo.name,
      description: categoryInfo.description,
      icon: categoryInfo.icon,
      color: categoryInfo.color
    },
    
    severity: {
      id: severity,
      name: severityInfo.name,
      description: severityInfo.description,
      icon: severityInfo.icon,
      color: severityInfo.color,
      priority: severityInfo.priority
    },
    
    recovery: {
      id: recoveryStrategy,
      name: recoveryInfo.name,
      description: recoveryInfo.description,
      icon: recoveryInfo.icon,
      automated: recoveryInfo.automated
    },
    
    // Actions
    actions: generateErrorActions(classifiedError),
    
    // Technical details (collapsed by default)
    technical: {
      originalMessage: originalError?.message || 'Unknown error',
      stack: originalError?.stack || null,
      code: errorCode || null,
      path: originalError?.path || null,
      timestamp: classifiedError.timestamp,
      context: classifiedError.context
    },
    
    // Formatting
    timestamp: new Date(classifiedError.timestamp).toLocaleString(),
    canRetry: isRetryable(classifiedError),
    canReport: true
  };
  
  return friendlyMessage;
}

/**
 * Generate actions for an error
 */
function generateErrorActions(classifiedError) {
  const actions = [];
  const { category, severity, recoveryStrategy } = classifiedError;
  
  // Primary action based on recovery strategy
  switch (recoveryStrategy) {
    case ERROR_RECOVERY_STRATEGIES.RETRY:
      actions.push({
        type: 'retry',
        label: 'Try Again',
        description: 'Retry the operation',
        primary: true,
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.FALLBACK:
      actions.push({
        type: 'fallback',
        label: 'Use Alternative',
        description: 'Try an alternative approach',
        primary: true,
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.ROLLBACK:
      actions.push({
        type: 'rollback',
        label: 'Undo Changes',
        description: 'Revert to previous state',
        primary: true,
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.MANUAL:
      actions.push({
        type: 'manual',
        label: 'Fix Manually',
        description: 'Follow manual steps',
        primary: true,
        automated: false
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.IGNORE:
      actions.push({
        type: 'ignore',
        label: 'Continue',
        description: 'Skip this error',
        primary: true,
        automated: true
      });
      break;
  }
  
  // Category-specific actions
  switch (category) {
    case ERROR_CATEGORIES.PATH_ERROR:
      actions.push({
        type: 'browse',
        label: 'Browse Files',
        description: 'Browse to select the correct file',
        primary: false,
        automated: false
      });
      break;
      
    case ERROR_CATEGORIES.PERMISSION_ERROR:
      actions.push({
        type: 'elevate',
        label: 'Run as Admin',
        description: 'Retry with elevated permissions',
        primary: false,
        automated: false
      });
      break;
      
    case ERROR_CATEGORIES.NETWORK_ERROR:
      actions.push({
        type: 'check_connection',
        label: 'Check Connection',
        description: 'Test network connectivity',
        primary: false,
        automated: true
      });
      break;
      
    case ERROR_CATEGORIES.CONFIGURATION_ERROR:
      actions.push({
        type: 'reset_config',
        label: 'Reset Config',
        description: 'Reset to default configuration',
        primary: false,
        automated: true
      });
      break;
      
    case ERROR_CATEGORIES.PROJECT_ERROR:
      actions.push({
        type: 'refresh_project',
        label: 'Refresh Project',
        description: 'Refresh project state',
        primary: false,
        automated: true
      });
      break;
  }
  
  // Always add secondary actions
  actions.push({
    type: 'report',
    label: 'Report Issue',
    description: 'Report this error for investigation',
    primary: false,
    automated: false
  });
  
  actions.push({
    type: 'dismiss',
    label: 'Dismiss',
    description: 'Close this error message',
    primary: false,
    automated: true
  });
  
  return actions;
}

/**
 * Check if error is retryable
 */
function isRetryable(classifiedError) {
  const retryableStrategies = [
    ERROR_RECOVERY_STRATEGIES.RETRY,
    ERROR_RECOVERY_STRATEGIES.FALLBACK
  ];
  
  const retryableCategories = [
    ERROR_CATEGORIES.TIMEOUT_ERROR,
    ERROR_CATEGORIES.NETWORK_ERROR,
    ERROR_CATEGORIES.PROCESS_ERROR
  ];
  
  return retryableStrategies.includes(classifiedError.recoveryStrategy) ||
         retryableCategories.includes(classifiedError.category);
}

/**
 * Generate contextual help text
 */
export function generateContextualHelp(classifiedError) {
  const { category, severity, originalError } = classifiedError;
  
  const helpSections = {
    overview: `This ${getErrorCategoryInfo(category).name.toLowerCase()} occurred while processing your request.`,
    impact: generateImpactDescription(severity),
    nextSteps: generateNextStepsDescription(classifiedError),
    prevention: generatePreventionTips(category)
  };
  
  return helpSections;
}

/**
 * Generate impact description based on severity
 */
function generateImpactDescription(severity) {
  const impactDescriptions = {
    [ERROR_SEVERITY.CRITICAL]: 'This is a critical error that may cause system instability or data loss.',
    [ERROR_SEVERITY.HIGH]: 'This error prevents the operation from completing successfully.',
    [ERROR_SEVERITY.MEDIUM]: 'This error may impact functionality but workarounds are available.',
    [ERROR_SEVERITY.LOW]: 'This is a minor issue that doesn\'t significantly impact functionality.'
  };
  
  return impactDescriptions[severity] || impactDescriptions[ERROR_SEVERITY.MEDIUM];
}

/**
 * Generate next steps description
 */
function generateNextStepsDescription(classifiedError) {
  const { recoveryStrategy, category } = classifiedError;
  
  const nextStepsMap = {
    [ERROR_RECOVERY_STRATEGIES.RETRY]: 'Try the operation again. If it continues to fail, check the underlying cause.',
    [ERROR_RECOVERY_STRATEGIES.FALLBACK]: 'The system will attempt to use an alternative approach automatically.',
    [ERROR_RECOVERY_STRATEGIES.ROLLBACK]: 'The system will revert any changes made before the error occurred.',
    [ERROR_RECOVERY_STRATEGIES.MANUAL]: 'This error requires manual intervention to resolve.',
    [ERROR_RECOVERY_STRATEGIES.IGNORE]: 'This error can be safely ignored and won\'t affect functionality.'
  };
  
  return nextStepsMap[recoveryStrategy] || 'Please review the error details and take appropriate action.';
}

/**
 * Generate prevention tips
 */
function generatePreventionTips(category) {
  const preventionTips = {
    [ERROR_CATEGORIES.PATH_ERROR]: [
      'Always verify file paths before operations',
      'Use absolute paths when possible',
      'Check file existence before accessing'
    ],
    [ERROR_CATEGORIES.PERMISSION_ERROR]: [
      'Ensure proper permissions are set',
      'Use appropriate user accounts',
      'Run with necessary privileges'
    ],
    [ERROR_CATEGORIES.NETWORK_ERROR]: [
      'Check network connectivity regularly',
      'Implement retry logic for network operations',
      'Use connection pooling for efficiency'
    ],
    [ERROR_CATEGORIES.TIMEOUT_ERROR]: [
      'Set appropriate timeout values',
      'Monitor operation performance',
      'Implement progress indicators'
    ],
    [ERROR_CATEGORIES.CONFIGURATION_ERROR]: [
      'Validate configuration before use',
      'Keep configuration backups',
      'Use configuration schemas'
    ],
    [ERROR_CATEGORIES.VALIDATION_ERROR]: [
      'Validate input at multiple levels',
      'Provide clear format requirements',
      'Use input sanitization'
    ],
    [ERROR_CATEGORIES.SYSTEM_ERROR]: [
      'Monitor system resources',
      'Implement resource limits',
      'Regular system maintenance'
    ],
    [ERROR_CATEGORIES.PROJECT_ERROR]: [
      'Maintain project structure',
      'Regular project health checks',
      'Keep project backups'
    ]
  };
  
  return preventionTips[category] || ['Follow best practices for error prevention'];
}

/**
 * Format error for display
 */
export function formatErrorForDisplay(friendlyMessage, options = {}) {
  const {
    showTechnicalDetails = false,
    showSuggestions = true,
    showActions = true,
    showTimestamp = true,
    compact = false
  } = options;
  
  const formatted = {
    header: {
      title: friendlyMessage.title,
      icon: friendlyMessage.icon,
      severity: friendlyMessage.severity,
      timestamp: showTimestamp ? friendlyMessage.timestamp : null
    },
    
    body: {
      message: friendlyMessage.message,
      suggestions: showSuggestions ? friendlyMessage.suggestions : null,
      category: friendlyMessage.category
    },
    
    actions: showActions ? friendlyMessage.actions : null,
    
    technical: showTechnicalDetails ? friendlyMessage.technical : null,
    
    metadata: {
      id: friendlyMessage.id,
      canRetry: friendlyMessage.canRetry,
      canReport: friendlyMessage.canReport,
      recovery: friendlyMessage.recovery
    }
  };
  
  if (compact) {
    return {
      title: formatted.header.title,
      message: formatted.body.message,
      actions: formatted.actions?.filter(a => a.primary) || [],
      severity: formatted.header.severity.id
    };
  }
  
  return formatted;
}

/**
 * Batch process multiple errors into friendly messages
 */
export function batchGenerateFriendlyMessages(classifiedErrors) {
  return classifiedErrors.map(error => generateUserFriendlyMessage(error));
}

/**
 * Get error message summary for notifications
 */
export function getErrorSummary(friendlyMessage) {
  const { title, severity, category } = friendlyMessage;
  
  return {
    title,
    severity: severity.id,
    category: category.id,
    icon: friendlyMessage.icon,
    canRetry: friendlyMessage.canRetry,
    timestamp: friendlyMessage.timestamp
  };
}

/**
 * Search friendly messages by criteria
 */
export function searchFriendlyMessages(messages, criteria) {
  return messages.filter(message => {
    const { category, severity, searchText } = criteria;
    
    if (category && message.category.id !== category) return false;
    if (severity && message.severity.id !== severity) return false;
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      return (
        message.title.toLowerCase().includes(searchLower) ||
        message.message.toLowerCase().includes(searchLower) ||
        message.technical.originalMessage.toLowerCase().includes(searchLower)
      );
    }
    
    return true;
  });
}

/**
 * Generate error report for support
 */
export function generateErrorReport(friendlyMessage) {
  const report = {
    id: friendlyMessage.id,
    timestamp: friendlyMessage.timestamp,
    title: friendlyMessage.title,
    message: friendlyMessage.message,
    category: friendlyMessage.category,
    severity: friendlyMessage.severity,
    technical: friendlyMessage.technical,
    context: friendlyMessage.technical.context,
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Node.js',
    url: typeof window !== 'undefined' ? window.location.href : 'N/A',
    suggestions: friendlyMessage.suggestions,
    actions: friendlyMessage.actions
  };
  
  return JSON.stringify(report, null, 2);
}