import { classifyError } from './errorClassification';

/**
 * Secure Error Logging Service
 * Logs errors without exposing sensitive information
 */

export const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info', 
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
};

export const LOG_CATEGORIES = {
  SYSTEM: 'system',
  NETWORK: 'network',
  USER: 'user',
  SECURITY: 'security',
  PERFORMANCE: 'performance'
};

// Sensitive data patterns to sanitize
const SENSITIVE_PATTERNS = [
  // API Keys and tokens
  /(?:api[_-]?key|token|secret|password|pwd|auth)["\s:=]+[a-zA-Z0-9\-_.~]+/gi,
  
  // JWT tokens
  /eyJ[a-zA-Z0-9\-_.~]+/g,
  
  // File paths that might contain usernames
  /\/Users\/[^\/\s]+/g,
  /\/home\/[^\/\s]+/g,
  /C:\\Users\\[^\\]+/g,
  
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Phone numbers
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  
  // Credit card patterns (basic)
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  
  // Social Security Numbers (US format)
  /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  
  // IP addresses (sometimes sensitive)
  /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g
];

// Fields to always exclude from logging
const EXCLUDED_FIELDS = [
  'password',
  'pwd',
  'secret',
  'token',
  'auth',
  'authorization',
  'cookie',
  'session',
  'csrf',
  'api_key',
  'apiKey',
  'privateKey',
  'private_key'
];

class SecureErrorLogger {
  constructor(options = {}) {
    this.options = {
      maxLogSize: 10000, // Maximum number of logs to keep
      enableConsoleLogging: true,
      enableLocalStorage: true,
      enableRemoteLogging: false,
      remoteEndpoint: null,
      logLevel: LOG_LEVELS.ERROR,
      sanitizeData: true,
      excludeFields: [...EXCLUDED_FIELDS, ...(options.excludeFields || [])],
      ...options
    };
    
    this.logs = [];
    this.sessionId = this.generateSessionId();
    this.initTime = Date.now();
    
    // Initialize storage
    if (this.options.enableLocalStorage) {
      this.loadLogsFromStorage();
    }
    
    // Set up periodic cleanup
    this.setupCleanup();
  }

  /**
   * Log an error with security sanitization
   */
  logError(error, context = {}, level = LOG_LEVELS.ERROR) {
    try {
      const classifiedError = classifyError(error);
      const sanitizedLog = this.createSanitizedLog(error, classifiedError, context, level);
      
      this.addLog(sanitizedLog);
      
      // Console logging
      if (this.options.enableConsoleLogging) {
        this.logToConsole(sanitizedLog);
      }
      
      // Local storage
      if (this.options.enableLocalStorage) {
        this.saveLogsToStorage();
      }
      
      // Remote logging
      if (this.options.enableRemoteLogging && this.options.remoteEndpoint) {
        this.logToRemote(sanitizedLog);
      }
      
      return sanitizedLog.id;
    } catch (loggingError) {
      // Fallback logging to console if main logging fails
      console.error('Error logging failed:', loggingError);
      console.error('Original error:', error);
    }
  }

  /**
   * Create sanitized log entry
   */
  createSanitizedLog(originalError, classifiedError, context, level) {
    const logId = this.generateLogId();
    const timestamp = new Date().toISOString();
    
    // Sanitize error message and stack
    const sanitizedMessage = this.sanitizeText(originalError?.message || 'Unknown error');
    const sanitizedStack = this.sanitizeStackTrace(originalError?.stack || '');
    
    // Sanitize context
    const sanitizedContext = this.sanitizeObject(context);
    
    // Create base log entry
    const logEntry = {
      id: logId,
      timestamp,
      sessionId: this.sessionId,
      level,
      
      // Error information (sanitized)
      error: {
        message: sanitizedMessage,
        name: originalError?.name || 'Error',
        code: originalError?.code || null,
        stack: sanitizedStack,
        sanitized: true
      },
      
      // Classification information
      classification: {
        category: classifiedError.category,
        severity: classifiedError.severity,
        recoveryStrategy: classifiedError.recoveryStrategy
      },
      
      // Context information (sanitized)
      context: sanitizedContext,
      
      // Environment information (safe)
      environment: this.getEnvironmentInfo(),
      
      // Performance metrics
      performance: this.getPerformanceMetrics(),
      
      // User agent (sanitized)
      userAgent: this.sanitizeUserAgent(),
      
      // URL (sanitized)
      url: this.sanitizeUrl()
    };
    
    return logEntry;
  }

  /**
   * Sanitize text content
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return text;
    
    let sanitized = text;
    
    // Apply sensitive pattern replacements
    SENSITIVE_PATTERNS.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });
    
    return sanitized;
  }

  /**
   * Sanitize stack trace
   */
  sanitizeStackTrace(stack) {
    if (!stack) return null;
    
    // Sanitize file paths in stack trace
    let sanitized = stack;
    
    // Replace full file paths with relative paths
    sanitized = sanitized.replace(/[A-Za-z]:[\\\/][^:\s]+/g, (match) => {
      const parts = match.split(/[\\\/]/);
      return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : match;
    });
    
    // Replace Unix-style paths
    sanitized = sanitized.replace(/\/[^:\s]+/g, (match) => {
      const parts = match.split('/');
      return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : match;
    });
    
    // Apply general text sanitization
    return this.sanitizeText(sanitized);
  }

  /**
   * Sanitize object data
   */
  sanitizeObject(obj, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return '[DEPTH_LIMIT]';
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      return this.sanitizeText(obj);
    }
    
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, depth + 1, maxDepth));
    }
    
    if (typeof obj === 'object') {
      const sanitized = {};
      
      for (const [key, value] of Object.entries(obj)) {
        // Skip excluded fields
        if (this.options.excludeFields.some(excluded => 
          key.toLowerCase().includes(excluded.toLowerCase())
        )) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        
        // Recursively sanitize value
        sanitized[key] = this.sanitizeObject(value, depth + 1, maxDepth);
      }
      
      return sanitized;
    }
    
    return String(obj);
  }

  /**
   * Get safe environment information
   */
  getEnvironmentInfo() {
    const env = {
      timestamp: this.initTime,
      sessionDuration: Date.now() - this.initTime,
      platform: 'unknown',
      nodeVersion: null,
      browserName: null,
      browserVersion: null,
      screen: null,
      memory: null,
      connection: null
    };
    
    if (typeof window !== 'undefined') {
      // Browser environment
      env.platform = 'browser';
      
      if (navigator) {
        env.browserName = this.getBrowserName();
        env.browserVersion = this.getBrowserVersion();
        
        if (navigator.connection) {
          env.connection = {
            effectiveType: navigator.connection.effectiveType,
            downlink: navigator.connection.downlink,
            rtt: navigator.connection.rtt
          };
        }
      }
      
      if (screen) {
        env.screen = {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth
        };
      }
      
      if (performance && performance.memory) {
        env.memory = {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
      }
    } else {
      // Node.js environment
      env.platform = 'node';
      
      if (typeof process !== 'undefined') {
        env.nodeVersion = process.version;
        env.memory = {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal
        };
      }
    }
    
    return env;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const metrics = {
      timestamp: Date.now(),
      navigation: null,
      resources: null,
      memory: null
    };
    
    if (typeof window !== 'undefined' && window.performance) {
      // Navigation timing
      if (performance.navigation) {
        metrics.navigation = {
          type: performance.navigation.type,
          redirectCount: performance.navigation.redirectCount
        };
      }
      
      // Resource timing (sample)
      if (performance.getEntriesByType) {
        const resources = performance.getEntriesByType('resource');
        metrics.resources = {
          count: resources.length,
          avgDuration: resources.length > 0 ? 
            resources.reduce((sum, r) => sum + r.duration, 0) / resources.length : 0
        };
      }
    }
    
    return metrics;
  }

  /**
   * Sanitize user agent
   */
  sanitizeUserAgent() {
    if (typeof window === 'undefined' || !navigator.userAgent) {
      return 'Unknown';
    }
    
    // Keep only browser name and version, remove detailed system info
    const ua = navigator.userAgent;
    const browserInfo = this.getBrowserName() + '/' + this.getBrowserVersion();
    return browserInfo;
  }

  /**
   * Sanitize URL
   */
  sanitizeUrl() {
    if (typeof window === 'undefined') {
      return null;
    }
    
    const url = new URL(window.location.href);
    
    // Remove sensitive query parameters
    const sensitiveParams = ['token', 'key', 'auth', 'session', 'password', 'secret'];
    sensitiveParams.forEach(param => {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, '[REDACTED]');
      }
    });
    
    return {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash ? '[HASH_PRESENT]' : null
    };
  }

  /**
   * Get browser name
   */
  getBrowserName() {
    if (typeof window === 'undefined' || !navigator.userAgent) {
      return 'Unknown';
    }
    
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    if (ua.includes('Opera')) return 'Opera';
    return 'Unknown';
  }

  /**
   * Get browser version
   */
  getBrowserVersion() {
    if (typeof window === 'undefined' || !navigator.userAgent) {
      return 'Unknown';
    }
    
    const ua = navigator.userAgent;
    const match = ua.match(/(?:Firefox|Chrome|Safari|Edge|Opera)\/([0-9.]+)/);
    return match ? match[1] : 'Unknown';
  }

  /**
   * Add log to memory
   */
  addLog(logEntry) {
    this.logs.unshift(logEntry);
    
    // Trim logs if exceeding max size
    if (this.logs.length > this.options.maxLogSize) {
      this.logs = this.logs.slice(0, this.options.maxLogSize);
    }
  }

  /**
   * Log to console
   */
  logToConsole(logEntry) {
    const { level, error, classification } = logEntry;
    
    const consoleMethod = {
      [LOG_LEVELS.DEBUG]: 'debug',
      [LOG_LEVELS.INFO]: 'info',
      [LOG_LEVELS.WARN]: 'warn',
      [LOG_LEVELS.ERROR]: 'error',
      [LOG_LEVELS.FATAL]: 'error'
    }[level] || 'log';
    
    console[consoleMethod](
      `[${level.toUpperCase()}] ${classification.category}:`,
      error.message,
      logEntry
    );
  }

  /**
   * Save logs to local storage
   */
  saveLogsToStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const logsToSave = this.logs.slice(0, 100); // Save only recent logs
        localStorage.setItem('errorLogs', JSON.stringify(logsToSave));
      }
    } catch (error) {
      console.warn('Failed to save logs to localStorage:', error);
    }
  }

  /**
   * Load logs from local storage
   */
  loadLogsFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem('errorLogs');
        if (stored) {
          const logs = JSON.parse(stored);
          this.logs = Array.isArray(logs) ? logs : [];
        }
      }
    } catch (error) {
      console.warn('Failed to load logs from localStorage:', error);
    }
  }

  /**
   * Log to remote endpoint
   */
  async logToRemote(logEntry) {
    try {
      if (!this.options.remoteEndpoint) return;
      
      const response = await fetch(this.options.remoteEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logEntry)
      });
      
      if (!response.ok) {
        console.warn('Remote logging failed:', response.status);
      }
    } catch (error) {
      console.warn('Remote logging error:', error);
    }
  }

  /**
   * Setup periodic cleanup
   */
  setupCleanup() {
    // Clean up old logs every 5 minutes
    setInterval(() => {
      const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
      this.logs = this.logs.filter(log => 
        new Date(log.timestamp).getTime() > cutoff
      );
      
      if (this.options.enableLocalStorage) {
        this.saveLogsToStorage();
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Get logs with optional filtering
   */
  getLogs(filters = {}) {
    let filtered = [...this.logs];
    
    if (filters.level) {
      filtered = filtered.filter(log => log.level === filters.level);
    }
    
    if (filters.category) {
      filtered = filtered.filter(log => 
        log.classification.category === filters.category
      );
    }
    
    if (filters.since) {
      const since = new Date(filters.since).getTime();
      filtered = filtered.filter(log => 
        new Date(log.timestamp).getTime() >= since
      );
    }
    
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }
    
    return filtered;
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
    
    if (this.options.enableLocalStorage) {
      try {
        localStorage.removeItem('errorLogs');
      } catch (error) {
        console.warn('Failed to clear logs from localStorage:', error);
      }
    }
  }

  /**
   * Export logs for support
   */
  exportLogs(format = 'json') {
    const exportData = {
      sessionId: this.sessionId,
      exportTimestamp: new Date().toISOString(),
      logCount: this.logs.length,
      logs: this.logs
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
        
      case 'csv':
        return this.exportToCSV(this.logs);
        
      default:
        return exportData;
    }
  }

  /**
   * Export logs to CSV format
   */
  exportToCSV(logs) {
    const headers = ['Timestamp', 'Level', 'Category', 'Message', 'Code', 'URL'];
    const rows = logs.map(log => [
      log.timestamp,
      log.level,
      log.classification.category,
      log.error.message,
      log.error.code || '',
      log.url?.pathname || ''
    ]);
    
    const csv = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    return csv;
  }

  /**
   * Get logging statistics
   */
  getStatistics() {
    const stats = {
      totalLogs: this.logs.length,
      byLevel: {},
      byCategory: {},
      bySeverity: {},
      sessionsLogged: new Set(this.logs.map(log => log.sessionId)).size,
      timeRange: {
        oldest: null,
        newest: null
      }
    };
    
    // Count by level
    Object.values(LOG_LEVELS).forEach(level => {
      stats.byLevel[level] = this.logs.filter(log => log.level === level).length;
    });
    
    // Count by category
    this.logs.forEach(log => {
      const category = log.classification.category;
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    });
    
    // Count by severity
    this.logs.forEach(log => {
      const severity = log.classification.severity;
      stats.bySeverity[severity] = (stats.bySeverity[severity] || 0) + 1;
    });
    
    // Time range
    if (this.logs.length > 0) {
      const timestamps = this.logs.map(log => new Date(log.timestamp).getTime());
      stats.timeRange.oldest = new Date(Math.min(...timestamps)).toISOString();
      stats.timeRange.newest = new Date(Math.max(...timestamps)).toISOString();
    }
    
    return stats;
  }

  /**
   * Generate session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generate log ID
   */
  generateLogId() {
    return `log_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

// Export singleton instance
export const secureErrorLogger = new SecureErrorLogger();

// Export convenience functions
export function logError(error, context = {}, level = LOG_LEVELS.ERROR) {
  return secureErrorLogger.logError(error, context, level);
}

export function getLogs(filters = {}) {
  return secureErrorLogger.getLogs(filters);
}

export function clearLogs() {
  return secureErrorLogger.clearLogs();
}

export function exportLogs(format = 'json') {
  return secureErrorLogger.exportLogs(format);
}

export function getLoggingStatistics() {
  return secureErrorLogger.getStatistics();
}

// Export React hook for error logging
export function useErrorLogging() {
  return {
    logError: (error, context, level) => secureErrorLogger.logError(error, context, level),
    getLogs: (filters) => secureErrorLogger.getLogs(filters),
    clearLogs: () => secureErrorLogger.clearLogs(),
    exportLogs: (format) => secureErrorLogger.exportLogs(format),
    getStatistics: () => secureErrorLogger.getStatistics()
  };
}

export default secureErrorLogger;