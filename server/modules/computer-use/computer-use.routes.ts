import express from 'express';

import { computerUseService } from '@/modules/computer-use/computer-use.service.js';

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ success: true, data: computerUseService.getStatus() });
});

router.post('/sessions', (_req, res) => {
  res.status(409).json({
    success: false,
    error: 'Computer Use is not enabled until a local CloudCLI Desktop Agent is connected and approved by the user.',
    data: computerUseService.getStatus(),
  });
});

export default router;
