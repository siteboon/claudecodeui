import express from 'express';

import {
  check9RouterHealth,
  get9RouterAccounts,
  get9RouterUsage,
} from '../services/nine-router.service.js';

const router = express.Router();

router.get('/status', async (_req, res) => {
  try {
    const [health, accounts, usage] = await Promise.all([
      check9RouterHealth(),
      get9RouterAccounts(),
      get9RouterUsage({ period: '24h' }),
    ]);
    res.json({ health, accounts, usage });
  } catch (error) {
    console.error('9Router status error:', error);
    res.status(500).json({ error: 'Failed to fetch 9Router status' });
  }
});

export default router;
