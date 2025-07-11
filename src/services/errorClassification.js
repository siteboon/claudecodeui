// Error Classification System
// Categorizes different types of errors for better handling and user experience

export const ERROR_CATEGORIES = {
  PATH_ERROR: 'path_error',
  PROJECT_ERROR: 'project_error', 
  SYSTEM_ERROR: 'system_error',
  NETWORK_ERROR: 'network_error',
  PERMISSION_ERROR: 'permission_error',
  VALIDATION_ERROR: 'validation_error',
  CONFIGURATION_ERROR: 'configuration_error',
  PROCESS_ERROR: 'process_error',
  TIMEOUT_ERROR: 'timeout_error',
  UNKNOWN_ERROR: 'unknown_error'
};

export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

export const ERROR_RECOVERY_STRATEGIES = {
  RETRY: 'retry',
  FALLBACK: 'fallback',
  ROLLBACK: 'rollback',
  MANUAL: 'manual',
  IGNORE: 'ignore'
};

// Error classification patterns
const ERROR_PATTERNS = {
  [ERROR_CATEGORIES.PATH_ERROR]: [
    /no such file or directory/i,
    /ENOENT/i,
    /ENOTDIR/i,
    /path.*not.*found/i,
    /invalid.*path/i,
    /directory.*does.*not.*exist/i,
    /file.*not.*found/i,
    /cannot.*access/i
  ],
  
  [ERROR_CATEGORIES.PERMISSION_ERROR]: [
    /permission.*denied/i,
    /EACCES/i,
    /EPERM/i,
    /access.*denied/i,
    /insufficient.*permissions/i,
    /not.*authorized/i,
    /forbidden/i,
    /unauthorized/i
  ],
  
  [ERROR_CATEGORIES.NETWORK_ERROR]: [
    /network.*error/i,
    /connection.*failed/i,
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /dns.*lookup.*failed/i,
    /fetch.*failed/i,
    /request.*failed/i,
    /unable.*to.*connect/i
  ],
  
  [ERROR_CATEGORIES.TIMEOUT_ERROR]: [
    /timeout/i,
    /timed.*out/i,
    /operation.*timeout/i,
    /request.*timeout/i,
    /connection.*timeout/i,
    /deadline.*exceeded/i
  ],
  
  [ERROR_CATEGORIES.PROCESS_ERROR]: [
    /spawn.*failed/i,
    /command.*not.*found/i,
    /process.*exited/i,
    /child.*process/i,
    /execution.*failed/i,
    /script.*error/i,
    /command.*failed/i
  ],
  
  [ERROR_CATEGORIES.CONFIGURATION_ERROR]: [
    /config.*error/i,
    /configuration.*invalid/i,
    /settings.*error/i,
    /malformed.*config/i,
    /invalid.*configuration/i,
    /config.*file.*not.*found/i,
    /syntax.*error.*in.*config/i
  ],
  
  [ERROR_CATEGORIES.VALIDATION_ERROR]: [
    /validation.*failed/i,
    /invalid.*input/i,
    /schema.*validation/i,
    /required.*field/i,
    /invalid.*format/i,
    /validation.*error/i,
    /input.*validation/i
  ],
  
  [ERROR_CATEGORIES.SYSTEM_ERROR]: [
    /system.*error/i,
    /internal.*error/i,
    /out.*of.*memory/i,
    /disk.*full/i,
    /ENOSPC/i,
    /resource.*unavailable/i,
    /system.*overload/i,
    /kernel.*error/i
  ],
  
  [ERROR_CATEGORIES.PROJECT_ERROR]: [
    /project.*not.*found/i,
    /project.*initialization.*failed/i,
    /invalid.*project/i,
    /project.*corruption/i,
    /project.*sync.*failed/i,
    /project.*registration.*failed/i
  ]
};

// Error severity classification
const SEVERITY_PATTERNS = {
  [ERROR_SEVERITY.CRITICAL]: [
    /critical/i,
    /fatal/i,
    /corrupt/i,
    /data.*loss/i,
    /system.*crash/i,
    /unrecoverable/i,
    /disk.*full/i,
    /out.*of.*memory/i
  ],
  
  [ERROR_SEVERITY.HIGH]: [
    /failed.*to.*start/i,
    /initialization.*failed/i,
    /connection.*lost/i,
    /authentication.*failed/i,
    /permission.*denied/i,
    /access.*denied/i,
    /service.*unavailable/i
  ],
  
  [ERROR_SEVERITY.MEDIUM]: [
    /warning/i,
    /deprecated/i,
    /timeout/i,
    /retry/i,
    /fallback/i,
    /partial.*failure/i,
    /temporary.*error/i
  ],
  
  [ERROR_SEVERITY.LOW]: [
    /info/i,
    /notice/i,
    /skip/i,
    /ignore/i,
    /minor/i,
    /cosmetic/i
  ]
};

// Recovery strategy classification
const RECOVERY_PATTERNS = {
  [ERROR_RECOVERY_STRATEGIES.RETRY]: [
    /timeout/i,
    /temporary/i,
    /network.*error/i,
    /connection.*failed/i,
    /service.*unavailable/i,
    /rate.*limit/i,
    /throttle/i
  ],
  
  [ERROR_RECOVERY_STRATEGIES.FALLBACK]: [
    /not.*found/i,
    /unavailable/i,
    /unsupported/i,
    /deprecated/i,
    /alternative/i,
    /fallback/i
  ],
  
  [ERROR_RECOVERY_STRATEGIES.ROLLBACK]: [
    /corrupt/i,
    /invalid.*state/i,
    /inconsistent/i,
    /failed.*to.*apply/i,
    /partial.*failure/i,
    /rollback/i
  ],
  
  [ERROR_RECOVERY_STRATEGIES.MANUAL]: [
    /permission.*denied/i,
    /access.*denied/i,
    /authentication.*required/i,
    /user.*action.*required/i,
    /manual.*intervention/i,
    /resolve.*manually/i
  ],
  
  [ERROR_RECOVERY_STRATEGIES.IGNORE]: [
    /warning/i,
    /informational/i,
    /non.*critical/i,
    /optional/i,
    /skip/i,
    /ignore/i
  ]
};

/**
 * Classifies an error into category, severity, and recovery strategy
 */
export function classifyError(error) {
  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  const errorStack = error?.stack || '';
  const errorCode = error?.code || error?.errno || null;
  
  // Get error category
  const category = getErrorCategory(errorMessage, errorCode);
  
  // Get error severity
  const severity = getErrorSeverity(errorMessage, category);
  
  // Get recovery strategy
  const recoveryStrategy = getRecoveryStrategy(errorMessage, category);
  
  // Get context information
  const context = getErrorContext(error);
  
  return {
    category,
    severity,
    recoveryStrategy,
    context,
    originalError: error,
    timestamp: new Date().toISOString(),
    errorId: generateErrorId(error)
  };
}

/**
 * Determine error category based on message and code
 */
function getErrorCategory(message, code) {
  // Check by error code first
  if (code) {
    const codeCategories = {
      'ENOENT': ERROR_CATEGORIES.PATH_ERROR,
      'ENOTDIR': ERROR_CATEGORIES.PATH_ERROR,
      'EACCES': ERROR_CATEGORIES.PERMISSION_ERROR,
      'EPERM': ERROR_CATEGORIES.PERMISSION_ERROR,
      'ECONNREFUSED': ERROR_CATEGORIES.NETWORK_ERROR,
      'ECONNRESET': ERROR_CATEGORIES.NETWORK_ERROR,
      'ETIMEDOUT': ERROR_CATEGORIES.TIMEOUT_ERROR,
      'ENOSPC': ERROR_CATEGORIES.SYSTEM_ERROR,
      'EMFILE': ERROR_CATEGORIES.SYSTEM_ERROR,
      'ENFILE': ERROR_CATEGORIES.SYSTEM_ERROR
    };
    
    if (codeCategories[code]) {
      return codeCategories[code];
    }
  }
  
  // Check by message patterns
  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(message))) {
      return category;
    }
  }
  
  return ERROR_CATEGORIES.UNKNOWN_ERROR;
}

/**
 * Determine error severity
 */
function getErrorSeverity(message, category) {
  // Check explicit severity patterns
  for (const [severity, patterns] of Object.entries(SEVERITY_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(message))) {
      return severity;
    }
  }
  
  // Default severity by category
  const defaultSeverities = {
    [ERROR_CATEGORIES.SYSTEM_ERROR]: ERROR_SEVERITY.CRITICAL,
    [ERROR_CATEGORIES.PERMISSION_ERROR]: ERROR_SEVERITY.HIGH,
    [ERROR_CATEGORIES.PROJECT_ERROR]: ERROR_SEVERITY.HIGH,
    [ERROR_CATEGORIES.NETWORK_ERROR]: ERROR_SEVERITY.MEDIUM,
    [ERROR_CATEGORIES.TIMEOUT_ERROR]: ERROR_SEVERITY.MEDIUM,
    [ERROR_CATEGORIES.PATH_ERROR]: ERROR_SEVERITY.MEDIUM,
    [ERROR_CATEGORIES.CONFIGURATION_ERROR]: ERROR_SEVERITY.MEDIUM,
    [ERROR_CATEGORIES.PROCESS_ERROR]: ERROR_SEVERITY.MEDIUM,
    [ERROR_CATEGORIES.VALIDATION_ERROR]: ERROR_SEVERITY.LOW,
    [ERROR_CATEGORIES.UNKNOWN_ERROR]: ERROR_SEVERITY.MEDIUM
  };
  
  return defaultSeverities[category] || ERROR_SEVERITY.MEDIUM;
}

/**
 * Determine recovery strategy
 */
function getRecoveryStrategy(message, category) {
  // Check explicit recovery patterns
  for (const [strategy, patterns] of Object.entries(RECOVERY_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(message))) {
      return strategy;
    }
  }
  
  // Default recovery strategy by category
  const defaultStrategies = {
    [ERROR_CATEGORIES.TIMEOUT_ERROR]: ERROR_RECOVERY_STRATEGIES.RETRY,
    [ERROR_CATEGORIES.NETWORK_ERROR]: ERROR_RECOVERY_STRATEGIES.RETRY,
    [ERROR_CATEGORIES.PERMISSION_ERROR]: ERROR_RECOVERY_STRATEGIES.MANUAL,
    [ERROR_CATEGORIES.PATH_ERROR]: ERROR_RECOVERY_STRATEGIES.FALLBACK,
    [ERROR_CATEGORIES.CONFIGURATION_ERROR]: ERROR_RECOVERY_STRATEGIES.FALLBACK,
    [ERROR_CATEGORIES.PROCESS_ERROR]: ERROR_RECOVERY_STRATEGIES.RETRY,
    [ERROR_CATEGORIES.VALIDATION_ERROR]: ERROR_RECOVERY_STRATEGIES.MANUAL,
    [ERROR_CATEGORIES.SYSTEM_ERROR]: ERROR_RECOVERY_STRATEGIES.ROLLBACK,
    [ERROR_CATEGORIES.PROJECT_ERROR]: ERROR_RECOVERY_STRATEGIES.ROLLBACK,
    [ERROR_CATEGORIES.UNKNOWN_ERROR]: ERROR_RECOVERY_STRATEGIES.MANUAL
  };
  
  return defaultStrategies[category] || ERROR_RECOVERY_STRATEGIES.MANUAL;
}

/**
 * Extract error context information
 */
function getErrorContext(error) {
  const context = {
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Node.js',
    platform: typeof window !== 'undefined' ? window.navigator.platform : process.platform,
    url: typeof window !== 'undefined' ? window.location.href : null,
    stack: error?.stack || null,
    cause: error?.cause || null
  };
  
  // Add additional context based on error type
  if (error?.code) {
    context.errorCode = error.code;
  }
  
  if (error?.errno) {
    context.errno = error.errno;
  }
  
  if (error?.path) {
    context.path = error.path;
  }
  
  if (error?.syscall) {
    context.syscall = error.syscall;
  }
  
  return context;
}

/**
 * Generate unique error ID
 */
function generateErrorId(error) {
  const message = error?.message || 'unknown';
  const timestamp = Date.now();
  const hash = simpleHash(message + timestamp);
  return `err_${hash.toString(36)}`;
}

/**
 * Simple hash function for error ID generation
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get error category information
 */
export function getErrorCategoryInfo(category) {
  const categoryInfo = {
    [ERROR_CATEGORIES.PATH_ERROR]: {
      name: 'Path Error',
      description: 'Errors related to file or directory paths',
      icon: '📁',
      color: 'orange'
    },
    [ERROR_CATEGORIES.PERMISSION_ERROR]: {
      name: 'Permission Error',
      description: 'Errors related to file or system permissions',
      icon: '🔒',
      color: 'red'
    },
    [ERROR_CATEGORIES.NETWORK_ERROR]: {
      name: 'Network Error',
      description: 'Errors related to network connectivity',
      icon: '🌐',
      color: 'blue'
    },
    [ERROR_CATEGORIES.TIMEOUT_ERROR]: {
      name: 'Timeout Error',
      description: 'Errors related to operation timeouts',
      icon: '⏱️',
      color: 'yellow'
    },
    [ERROR_CATEGORIES.PROCESS_ERROR]: {
      name: 'Process Error',
      description: 'Errors related to process execution',
      icon: '⚙️',
      color: 'purple'
    },
    [ERROR_CATEGORIES.CONFIGURATION_ERROR]: {
      name: 'Configuration Error',
      description: 'Errors related to configuration settings',
      icon: '🔧',
      color: 'teal'
    },
    [ERROR_CATEGORIES.VALIDATION_ERROR]: {
      name: 'Validation Error',
      description: 'Errors related to input validation',
      icon: '✅',
      color: 'green'
    },
    [ERROR_CATEGORIES.SYSTEM_ERROR]: {
      name: 'System Error',
      description: 'Errors related to system resources',
      icon: '💾',
      color: 'red'
    },
    [ERROR_CATEGORIES.PROJECT_ERROR]: {
      name: 'Project Error',
      description: 'Errors related to project operations',
      icon: '📋',
      color: 'indigo'
    },
    [ERROR_CATEGORIES.UNKNOWN_ERROR]: {
      name: 'Unknown Error',
      description: 'Errors that could not be classified',
      icon: '❓',
      color: 'gray'
    }
  };
  
  return categoryInfo[category] || categoryInfo[ERROR_CATEGORIES.UNKNOWN_ERROR];
}

/**
 * Get error severity information
 */
export function getErrorSeverityInfo(severity) {
  const severityInfo = {
    [ERROR_SEVERITY.CRITICAL]: {
      name: 'Critical',
      description: 'System-threatening errors requiring immediate attention',
      icon: '🚨',
      color: 'red',
      priority: 4
    },
    [ERROR_SEVERITY.HIGH]: {
      name: 'High',
      description: 'Significant errors affecting functionality',
      icon: '🔴',
      color: 'red',
      priority: 3
    },
    [ERROR_SEVERITY.MEDIUM]: {
      name: 'Medium',
      description: 'Moderate errors with workarounds available',
      icon: '🟡',
      color: 'yellow',
      priority: 2
    },
    [ERROR_SEVERITY.LOW]: {
      name: 'Low',
      description: 'Minor errors or informational messages',
      icon: '🟢',
      color: 'green',
      priority: 1
    }
  };
  
  return severityInfo[severity] || severityInfo[ERROR_SEVERITY.MEDIUM];
}

/**
 * Get recovery strategy information
 */
export function getRecoveryStrategyInfo(strategy) {
  const strategyInfo = {
    [ERROR_RECOVERY_STRATEGIES.RETRY]: {
      name: 'Retry',
      description: 'Automatically retry the operation',
      icon: '🔄',
      automated: true
    },
    [ERROR_RECOVERY_STRATEGIES.FALLBACK]: {
      name: 'Fallback',
      description: 'Use alternative method or resource',
      icon: '🔀',
      automated: true
    },
    [ERROR_RECOVERY_STRATEGIES.ROLLBACK]: {
      name: 'Rollback',
      description: 'Revert to previous state',
      icon: '↩️',
      automated: true
    },
    [ERROR_RECOVERY_STRATEGIES.MANUAL]: {
      name: 'Manual',
      description: 'Requires user intervention',
      icon: '👤',
      automated: false
    },
    [ERROR_RECOVERY_STRATEGIES.IGNORE]: {
      name: 'Ignore',
      description: 'Safe to ignore or skip',
      icon: '⏭️',
      automated: true
    }
  };
  
  return strategyInfo[strategy] || strategyInfo[ERROR_RECOVERY_STRATEGIES.MANUAL];
}

/**
 * Batch classify multiple errors
 */
export function batchClassifyErrors(errors) {
  return errors.map(error => classifyError(error));
}

/**
 * Get error statistics from classified errors
 */
export function getErrorStatistics(classifiedErrors) {
  const stats = {
    total: classifiedErrors.length,
    byCategory: {},
    bySeverity: {},
    byRecoveryStrategy: {},
    topErrors: []
  };
  
  // Count by category
  Object.values(ERROR_CATEGORIES).forEach(category => {
    stats.byCategory[category] = classifiedErrors.filter(e => e.category === category).length;
  });
  
  // Count by severity
  Object.values(ERROR_SEVERITY).forEach(severity => {
    stats.bySeverity[severity] = classifiedErrors.filter(e => e.severity === severity).length;
  });
  
  // Count by recovery strategy
  Object.values(ERROR_RECOVERY_STRATEGIES).forEach(strategy => {
    stats.byRecoveryStrategy[strategy] = classifiedErrors.filter(e => e.recoveryStrategy === strategy).length;
  });
  
  // Get top error messages
  const errorCounts = {};
  classifiedErrors.forEach(error => {
    const message = error.originalError?.message || 'Unknown error';
    errorCounts[message] = (errorCounts[message] || 0) + 1;
  });
  
  stats.topErrors = Object.entries(errorCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));
  
  return stats;
}

/**
 * Check if error is recoverable
 */
export function isErrorRecoverable(classifiedError) {
  const recoverableStrategies = [
    ERROR_RECOVERY_STRATEGIES.RETRY,
    ERROR_RECOVERY_STRATEGIES.FALLBACK,
    ERROR_RECOVERY_STRATEGIES.ROLLBACK
  ];
  
  return recoverableStrategies.includes(classifiedError.recoveryStrategy) &&
         classifiedError.severity !== ERROR_SEVERITY.CRITICAL;
}

/**
 * Get suggested actions for an error
 */
export function getSuggestedActions(classifiedError) {
  const actions = [];
  
  switch (classifiedError.recoveryStrategy) {
    case ERROR_RECOVERY_STRATEGIES.RETRY:
      actions.push({
        type: 'retry',
        label: 'Try Again',
        description: 'Retry the operation that failed',
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.FALLBACK:
      actions.push({
        type: 'fallback',
        label: 'Use Alternative',
        description: 'Try an alternative approach',
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.ROLLBACK:
      actions.push({
        type: 'rollback',
        label: 'Rollback Changes',
        description: 'Revert to previous working state',
        automated: true
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.MANUAL:
      actions.push({
        type: 'manual',
        label: 'Manual Resolution',
        description: 'Follow manual steps to resolve',
        automated: false
      });
      break;
      
    case ERROR_RECOVERY_STRATEGIES.IGNORE:
      actions.push({
        type: 'ignore',
        label: 'Continue',
        description: 'Skip this error and continue',
        automated: true
      });
      break;
  }
  
  // Always add general actions
  actions.push({
    type: 'report',
    label: 'Report Issue',
    description: 'Report this error for investigation',
    automated: false
  });
  
  return actions;
}