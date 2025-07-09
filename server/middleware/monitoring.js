const { logger } = require('../utils/logger');

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  const startHrTime = process.hrtime();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - start;
    const [seconds, nanoseconds] = process.hrtime(startHrTime);
    const preciseTime = seconds * 1000 + nanoseconds / 1000000;
    
    // Log API performance
    logger.api(req.path, req.method, res.statusCode, responseTime, {
      preciseTime: preciseTime.toFixed(2) + 'ms',
      contentLength: res.get('Content-Length') || 0,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });
    
    originalEnd.apply(this, args);
  };
  
  next();
};

// Health check endpoint
const healthCheck = (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    memory: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    },
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };
  
  logger.info('Health check requested', health);
  res.json(health);
};

// Metrics endpoint
const metrics = (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: uptime,
    memory: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss,
      external: memoryUsage.external
    },
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 3000
    }
  };
  
  logger.debug('Metrics requested', metrics);
  res.json(metrics);
};

// Request counter
let requestCount = 0;
let errorCount = 0;

const requestCounter = (req, res, next) => {
  requestCount++;
  
  // Count errors
  const originalEnd = res.end;
  res.end = function(...args) {
    if (res.statusCode >= 400) {
      errorCount++;
    }
    originalEnd.apply(this, args);
  };
  
  next();
};

// Stats endpoint
const stats = (req, res) => {
  const stats = {
    timestamp: new Date().toISOString(),
    requests: {
      total: requestCount,
      errors: errorCount,
      errorRate: requestCount > 0 ? (errorCount / requestCount * 100).toFixed(2) + '%' : '0%'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  logger.info('Stats requested', stats);
  res.json(stats);
};

// WebSocket monitoring
const wsMonitor = {
  connections: 0,
  totalConnections: 0,
  
  onConnection: (ws, type) => {
    wsMonitor.connections++;
    wsMonitor.totalConnections++;
    
    logger.websocket('connection', `New ${type} connection`, {
      activeConnections: wsMonitor.connections,
      totalConnections: wsMonitor.totalConnections
    });
    
    ws.on('close', () => {
      wsMonitor.connections--;
      logger.websocket('disconnect', `${type} connection closed`, {
        activeConnections: wsMonitor.connections
      });
    });
  },
  
  getStats: () => ({
    activeConnections: wsMonitor.connections,
    totalConnections: wsMonitor.totalConnections
  })
};

// Directory operation monitoring
const directoryOpMonitor = (operation) => {
  return (req, res, next) => {
    const start = Date.now();
    const path = req.query.path || req.body.path || 'unknown';
    
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - start;
      
      logger.performance(`directory_${operation}`, duration, {
        path: path,
        statusCode: res.statusCode,
        success: res.statusCode < 400
      });
      
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

module.exports = {
  performanceMonitor,
  healthCheck,
  metrics,
  stats,
  requestCounter,
  wsMonitor,
  directoryOpMonitor
};