/**
 * CLI Auth Routes
 *
 * Thin router that delegates to per-provider status checkers
 * registered in the provider registry.
 *
 * @module routes/cli-auth
 */

import express from 'express';
import { getAllProviders, getStatusChecker } from '../providers/registry.js';

const router = express.Router();

for (const provider of getAllProviders()) {
  router.get(`/${provider}/status`, async (req, res) => {
    try {
      const checker = getStatusChecker(provider);
      res.json(await checker.checkStatus());
    } catch (error) {
      console.error(`Error checking ${provider} status:`, error);
      res.status(500).json({ authenticated: false, error: error.message });
    }
  });
}

export default router;
