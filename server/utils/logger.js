const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Current log level (configurable via environment)
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO;

// Log directory
const LOG_DIR = path.join(__dirname, '../../logs');

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create log directory:', error);
}

// Logger class
class Logger {
  constructor() {
    this.logFile = path.join(LOG_DIR, 'server.log');
    this.errorFile = path.join(LOG_DIR, 'error.log');
    this.accessFile = path.join(LOG_DIR, 'access.log');
    this.performanceFile = path.join(LOG_DIR, 'performance.log');
  }

  // Format log message
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };
    
    return JSON.stringify(logEntry);
  }

  // Write to file
  writeToFile(file, message) {
    try {
      const logEntry = message + '\n';
      fs.appendFileSync(file, logEntry);
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  // Log to console with colors
  logToConsole(level, message, meta = {}) {
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[90m'  // Gray
    };
    
    const reset = '\x1b[0m';
    const color = colors[level] || '';
    
    const timestamp = new Date().toISOString();
    const metaString = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    
    console.log(`${color}[${timestamp}] ${level}: ${message}${metaString}${reset}`);
  }

  // Generic log method
  log(level, message, meta = {}) {
    const levelValue = LOG_LEVELS[level];
    
    if (levelValue <= CURRENT_LOG_LEVEL) {
      // Log to console
      this.logToConsole(level, message, meta);
      
      // Log to file
      const formattedMessage = this.formatMessage(level, message, meta);
      this.writeToFile(this.logFile, formattedMessage);
      
      // Log errors to separate file
      if (level === 'ERROR') {
        this.writeToFile(this.errorFile, formattedMessage);
      }
    }
  }

  // Specific log methods
  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }

  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }

  debug(message, meta = {}) {
    this.log('DEBUG', message, meta);
  }

  // HTTP access logging
  access(req, res, responseTime) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      statusCode: res.statusCode,
      responseTime: responseTime + 'ms',
      contentLength: res.get('Content-Length') || 0
    };
    
    // Log to console
    const statusColor = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`${statusColor}${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms\x1b[0m`);
    
    // Log to access file
    this.writeToFile(this.accessFile, JSON.stringify(logEntry));
  }

  // Performance monitoring
  performance(operation, duration, meta = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      duration: duration + 'ms',
      ...meta
    };
    
    // Log to console if duration is high
    if (duration > 1000) {
      this.warn(`Slow operation: ${operation} took ${duration}ms`, meta);
    }
    
    // Log to performance file
    this.writeToFile(this.performanceFile, JSON.stringify(logEntry));
  }

  // WebSocket logging
  websocket(type, message, meta = {}) {
    this.info(`WebSocket ${type}: ${message}`, meta);
  }

  // API endpoint logging
  api(endpoint, method, status, duration, meta = {}) {
    const logLevel = status >= 400 ? 'ERROR' : 'INFO';
    const message = `API ${method} ${endpoint} - ${status} - ${duration}ms`;
    
    this.log(logLevel, message, meta);
  }

  // System monitoring
  system(metric, value, unit = '') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      metric,
      value,
      unit
    };
    
    this.debug(`System: ${metric} = ${value}${unit}`);
    this.writeToFile(this.performanceFile, JSON.stringify(logEntry));
  }
}

// Create singleton instance
const logger = new Logger();

// Performance monitoring middleware
const performanceMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - start;
    logger.access(req, res, responseTime);
    originalEnd.apply(this, args);
  };
  
  next();
};

// Error tracking
const trackError = (error, context = {}) => {
  logger.error(error.message, {
    stack: error.stack,
    ...context
  });
};

// System metrics collection
const collectSystemMetrics = () => {
  const used = process.memoryUsage();
  
  logger.system('memory.heapUsed', Math.round(used.heapUsed / 1024 / 1024), 'MB');
  logger.system('memory.heapTotal', Math.round(used.heapTotal / 1024 / 1024), 'MB');
  logger.system('memory.rss', Math.round(used.rss / 1024 / 1024), 'MB');
  logger.system('uptime', Math.round(process.uptime()), 'seconds');
};

// Start system metrics collection
setInterval(collectSystemMetrics, 60000); // Every minute

module.exports = {
  logger,
  performanceMiddleware,
  trackError,
  collectSystemMetrics
};