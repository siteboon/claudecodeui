import express from 'express';
import { deleteCodexSession } from '../projects.js';
import { sessionsDb } from '../modules/database/index.js';

const router = express.Router();

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await deleteCodexSession(sessionId);
    sessionsDb.deleteName(sessionId, 'codex');
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting Codex session ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
