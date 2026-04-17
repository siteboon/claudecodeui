import express from 'express';

import { providerAuthService } from '../modules/providers/services/provider-auth.service.js';

const router = express.Router();

/**
 * Creates a status route handler for one provider while preserving the existing
 * /api/cli/<provider>/status endpoint shape.
 */
function createProviderStatusHandler(providerName) {
  return async (req, res) => {
    try {
      const status = await providerAuthService.getProviderAuthStatus(providerName);
      return res.json(status);
    } catch (error) {
      console.error(`Error checking ${providerName} auth status:`, error);
      return res.status(500).json({
        installed: false,
        provider: providerName,
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Failed to check provider auth status',
      });
    }
  };
}

router.get('/claude/status', createProviderStatusHandler('claude'));
router.get('/cursor/status', createProviderStatusHandler('cursor'));
router.get('/codex/status', createProviderStatusHandler('codex'));
router.get('/gemini/status', createProviderStatusHandler('gemini'));

export default router;
