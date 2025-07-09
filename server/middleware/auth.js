const authMiddleware = (req, res, next) => {
  // Skip auth for verification endpoint
  if (req.path === '/api/auth/verify' || req.path === '/api/auth/check') {
    return next();
  }

  const authToken = process.env.AUTH_TOKEN;
  if (!authToken) {
    console.error('AUTH_TOKEN not configured in .env file');
    return res.status(500).json({ error: 'Server authentication not configured' });
  }

  // Check cookie first, then Authorization header
  const tokenFromCookie = req.cookies?.auth_token;
  const tokenFromHeader = req.headers.authorization?.replace('Bearer ', '');
  
  const providedToken = tokenFromCookie || tokenFromHeader;

  if (!providedToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (providedToken !== authToken) {
    return res.status(401).json({ error: 'Invalid authentication token' });
  }

  next();
};

module.exports = authMiddleware;