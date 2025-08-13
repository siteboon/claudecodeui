import express from 'express';

const router = express.Router();

// Development mode authentication bypass
// WARNING: This should ONLY be used in development!

// Mock login - creates a fake session without actual authentication
router.get('/login', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Development auth not available in production' });
  }
  
  // Create a mock user session
  req.session.user = {
    id: 'dev-user-001',
    username: 'developer',
    email: 'dev@localhost',
    name: 'Development User',
    groups: ['developers', 'admin']
  };
  
  res.json({ 
    success: true, 
    message: 'Development mode - logged in without authentication',
    user: req.session.user 
  });
});

// Get current user info
router.get('/user', (req, res) => {
  res.json({ 
    user: req.session.user || null,
    devMode: true 
  });
});

// Mock logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, devMode: true });
});

// Check authentication status
router.get('/status', (req, res) => {
  res.json({
    isAuthenticated: !!req.session.user,
    user: req.session.user || null,
    devMode: true,
    configured: false
  });
});

export default router;