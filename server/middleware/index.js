const path = require('path');

// Request validation middleware
const validateRequest = (req, res, next) => {
  // Log all incoming requests
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  // Validate Content-Type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'Content-Type must be application/json'
      });
    }
  }
  
  // Basic path validation to prevent directory traversal
  if (req.query.path) {
    const requestPath = req.query.path;
    if (requestPath.includes('..') || requestPath.includes('\\..') || requestPath.includes('../')) {
      return res.status(400).json({
        error: 'Invalid path: directory traversal not allowed'
      });
    }
  }
  
  // Validate path in request body
  if (req.body && req.body.path) {
    const requestPath = req.body.path;
    if (requestPath.includes('..') || requestPath.includes('\\..') || requestPath.includes('../')) {
      return res.status(400).json({
        error: 'Invalid path: directory traversal not allowed'
      });
    }
  }
  
  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  let statusCode = 500;
  let message = 'Internal Server Error';
  
  // Handle specific error types
  if (err.code === 'ENOENT') {
    statusCode = 404;
    message = 'File or directory not found';
  } else if (err.code === 'EACCES') {
    statusCode = 403;
    message = 'Permission denied';
  } else if (err.code === 'ENOTDIR') {
    statusCode = 400;
    message = 'Path is not a directory';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'SyntaxError' && err.message.includes('JSON')) {
    statusCode = 400;
    message = 'Invalid JSON in request body';
  }
  
  const response = {
    error: message,
    timestamp: new Date().toISOString(),
    path: req.path
  };
  
  // Add error details in development
  if (isDevelopment) {
    response.details = err.message;
    response.stack = err.stack;
  }
  
  res.status(statusCode).json(response);
};

// Rate limiting middleware (simple implementation)
const rateLimiter = (() => {
  const requests = new Map();
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 100; // Max requests per window
  
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Clean old entries
    for (const [ip, data] of requests.entries()) {
      if (now - data.resetTime > WINDOW_MS) {
        requests.delete(ip);
      }
    }
    
    // Check current client
    if (!requests.has(clientIp)) {
      requests.set(clientIp, {
        count: 1,
        resetTime: now
      });
    } else {
      const clientData = requests.get(clientIp);
      
      if (now - clientData.resetTime > WINDOW_MS) {
        // Reset window
        clientData.count = 1;
        clientData.resetTime = now;
      } else {
        clientData.count++;
        
        if (clientData.count > MAX_REQUESTS) {
          return res.status(429).json({
            error: 'Too many requests',
            message: `Rate limit exceeded. Try again in ${Math.ceil((WINDOW_MS - (now - clientData.resetTime)) / 1000)} seconds.`
          });
        }
      }
    }
    
    // Add rate limit headers
    const clientData = requests.get(clientIp);
    const remaining = Math.max(0, MAX_REQUESTS - clientData.count);
    const resetTime = Math.ceil((clientData.resetTime + WINDOW_MS) / 1000);
    
    res.set({
      'X-RateLimit-Limit': MAX_REQUESTS,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetTime
    });
    
    next();
  };
})();

// Security middleware
const securityHeaders = (req, res, next) => {
  // Remove server header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  
  // Add CORS headers for API endpoints
  if (req.path.startsWith('/api/')) {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
  }
  
  next();
};

// Request timeout middleware
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request timeout',
          message: 'Request took too long to process'
        });
      }
    }, timeoutMs);
    
    // Clear timeout when response finishes
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
    next();
  };
};

// Body size limit middleware
const bodySizeLimit = (limit = '10mb') => {
  return (req, res, next) => {
    if (req.headers['content-length']) {
      const contentLength = parseInt(req.headers['content-length']);
      const limitBytes = parseSize(limit);
      
      if (contentLength > limitBytes) {
        return res.status(413).json({
          error: 'Request entity too large',
          message: `Request body size (${contentLength} bytes) exceeds limit (${limitBytes} bytes)`
        });
      }
    }
    
    next();
  };
};

// Helper function to parse size strings
function parseSize(size) {
  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };
  
  const match = size.toString().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = match[2] || 'b';
  
  return Math.floor(value * (units[unit] || 1));
}

module.exports = {
  validateRequest,
  errorHandler,
  rateLimiter,
  securityHeaders,
  requestTimeout,
  bodySizeLimit
};