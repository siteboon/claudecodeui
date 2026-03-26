import express, { type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { userDb } from '@/shared/database/repositories/users.js';
import { getConnection } from '@/shared/database/connection.js';
import { generateToken, authenticateToken } from './auth.middleware.js';
import type { AuthenticatedRequest } from '@/shared/types/http.js';
import { logger } from '@/shared/utils/logger.js';

export const authRoutes = express.Router();

/**
 * Check auth status and setup requirements
 * GET /api/auth/status
 */
authRoutes.get('/status', (req: Request, res: Response) => {
  try {
    const hasUsers = userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    logger.error('Auth status error:', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * User registration (setup) - only allowed if no users exist
 * POST /api/auth/register
 */
authRoutes.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    
    if (username.length < 3 || password.length < 6) {
      res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
      return;
    }
    
    const db = getConnection();
    
    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        res.status(403).json({ error: 'User already exists. This is a single-user system.' });
        return;
      }
      
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      // Create user
      const user = userDb.createUser(username, passwordHash);
      
      // Generate token
      const token = generateToken(user);
      
      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(Number(user.id));

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error: any) {
    logger.error('Registration error:', { error });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * User login
 * POST /api/auth/login
 */
authRoutes.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    logger.error('Login error:', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get current user (protected route)
 * GET /api/auth/user
 */
authRoutes.get('/user', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    user: req.user
  });
});

/**
 * Logout (client-side token removal, but this endpoint can be used for logging)
 * POST /api/auth/logout
 */
authRoutes.post('/logout', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});
