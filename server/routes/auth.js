import express from 'express';
import bcrypt from 'bcrypt';
import { userDb, db } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import passport from '../auth/passport.js';
import { isAllowedUser } from '../auth/strategies/github.js';

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    const githubConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    const allowedUsers = process.env.GITHUB_ALLOWED_USERS
      ? process.env.GITHUB_ALLOWED_USERS.split(',').map(u => u.trim())
      : [];

    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false,
      githubConfigured,
      githubAllowedUsers: allowedUsers
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

router.post('/logout', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/github', (req, res, next) => {
  if (req.query.returnUrl) {
    req.session.returnUrl = req.query.returnUrl;
  }
  passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
});

router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: '/login?error=github_auth_failed' }),
  async (req, res) => {
    try {
      const token = generateToken(req.user);

      userDb.updateUserLastLogin(req.user.id);

      const returnUrl = req.session.returnUrl || '/';
      delete req.session.returnUrl;

      res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3009'}${returnUrl}?token=${token}`);
    } catch (error) {
      console.error('GitHub callback error:', error);
      res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3009'}/login?error=auth_failed`);
    }
  }
);

router.get('/github/check/:username', (req, res) => {
  const { username } = req.params;
  const allowed = isAllowedUser(username);
  res.json({ allowed });
});

router.get('/github/status', authenticateToken, (req, res) => {
  res.json({
    isGithubAuthenticated: req.user.auth_provider === 'github',
    githubUsername: req.user.github_username || null
  });
});

export default router;
