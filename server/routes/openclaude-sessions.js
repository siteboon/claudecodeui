import express from 'express';

import {
  parseOpenClaudeSessionDir,
  OPENCLAUDE_PROJECTS_DIR,
} from '../services/openclaude-sessions.service.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const sessions = await parseOpenClaudeSessionDir(OPENCLAUDE_PROJECTS_DIR);
    res.json({ sessions });
  } catch (error) {
    console.error('OpenClaude sessions error:', error);
    res.status(500).json({ error: 'Failed to read OpenClaude sessions' });
  }
});

export default router;
