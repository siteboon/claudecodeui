import express, { type Response } from 'express';
import { userDb } from '@/shared/database/repositories/users.js';
import { authenticateToken } from '@/modules/auth/auth.middleware.js';
import { getSystemGitConfig, spawnAsync } from '@/shared/utils/git-config.js';
import type { AuthenticatedRequest } from '@/shared/types/http.js';
import { logger } from '@/shared/utils/logger.js';

export const userRoutes = express.Router();

/**
 * Get the user's git config.
 * Falls back to system's global git config if not set in the DB.
 */
userRoutes.get('/git-config', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    
    const userId = Number(req.user.id);
    let gitConfig = userDb.getGitConfig(userId);

    // If database is empty, try to get from system git config
    if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
      const systemConfig = await getSystemGitConfig();

      // If system has values, save them to database for this user
      if (systemConfig.git_name || systemConfig.git_email) {
        userDb.updateGitConfig(userId, systemConfig.git_name || '', systemConfig.git_email || '');
        gitConfig = systemConfig;
        logger.info(`Auto-populated git config from system for user ${userId}: ${systemConfig.git_name} <${systemConfig.git_email}>`);
      }
    }

    res.json({
      success: true,
      gitName: gitConfig?.git_name || null,
      gitEmail: gitConfig?.git_email || null
    });
  } catch (error) {
    logger.error('Error getting git config:', { error });
    res.status(500).json({ error: 'Failed to get git configuration' });
  }
});

/**
 * Apply git config globally via git config --global and save to DB
 */
userRoutes.post('/git-config', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const userId = Number(req.user.id);
    const { gitName, gitEmail } = req.body;

    if (!gitName || !gitEmail) {
      res.status(400).json({ error: 'Git name and email are required' });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(gitEmail)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    userDb.updateGitConfig(userId, gitName, gitEmail);

    try {
      await spawnAsync('git', ['config', '--global', 'user.name', String(gitName)]);
      await spawnAsync('git', ['config', '--global', 'user.email', String(gitEmail)]);
      logger.info(`Applied git config globally: ${gitName} <${gitEmail}>`);
    } catch (gitError) {
      logger.error('Error applying git config:', { error: gitError });
    }

    res.json({
      success: true,
      gitName,
      gitEmail
    });
  } catch (error) {
    logger.error('Error updating git config:', { error });
    res.status(500).json({ error: 'Failed to update git configuration' });
  }
});

/**
 * Complete onboarding for the user
 */
userRoutes.post('/complete-onboarding', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const userId = Number(req.user.id);
    userDb.completeOnboarding(userId);

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    logger.error('Error completing onboarding:', { error });
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * Get onboarding status for the user
 */
userRoutes.get('/onboarding-status', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const userId = Number(req.user.id);
    const hasCompleted = userDb.hasCompletedOnboarding(userId);

    res.json({
      success: true,
      hasCompletedOnboarding: hasCompleted
    });
  } catch (error) {
    logger.error('Error checking onboarding status:', { error });
    res.status(500).json({ error: 'Failed to check onboarding status' });
  }
});
