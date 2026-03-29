import express from 'express';
import sessionManager from '../sessionManager.js';
import { sessionNamesDb } from '../database/db.js';
import { deleteGeminiCliSession } from '../projects.js';

const router = express.Router();

router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        // Try deleting from UI sessions and CLI sessions
        let deleted = false;
        try {
            await sessionManager.deleteSession(sessionId);
            deleted = true;
        } catch { }

        try {
            await deleteGeminiCliSession(sessionId);
            deleted = true;
        } catch { }

        sessionNamesDb.deleteName(sessionId, 'gemini');
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting Gemini session ${req.params.sessionId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
