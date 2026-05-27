import express from 'express';
import { credentialsDb } from '../modules/database/index.js';
import { getClaudeUsage } from '../services/claudeUsageService.js';

const router = express.Router();

router.get('/claude', async (req, res) => {
  try {
    const userId = req.user.id;
    const forceRefresh = req.query.refresh === '1';

    const sessionKey = credentialsDb.getActiveCredential(userId, 'claude_session');
    if (!sessionKey) {
      return res.json({ success: true, data: null, hasSessionKey: false });
    }

    const data = await getClaudeUsage(userId, sessionKey, forceRefresh);
    res.json({ success: true, data, hasSessionKey: true });
  } catch (error) {
    console.error('Error fetching Claude usage:', error);
    res.status(500).json({ error: 'Failed to fetch Claude usage' });
  }
});

export default router;
