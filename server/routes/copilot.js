import express from 'express';
import sessionManager from '../sessionManager.js';
import { sessionNamesDb } from '../database/db.js';
import { getCopilotSessionOwner, removeCopilotSessionOwner } from '../copilot-cli.js';

const router = express.Router();

router.get('/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        // Verify session ownership: reject if the session belongs to a different user
        const ownerId = getCopilotSessionOwner(sessionId);
        if (ownerId && req.user && req.user.id !== ownerId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let messages = sessionManager.getSessionMessages(sessionId);

        res.json({
            success: true,
            messages: messages,
            total: messages.length,
            hasMore: false,
            offset: 0,
            limit: messages.length
        });
    } catch (error) {
        console.error('Error fetching Copilot session messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        // Verify session ownership: reject if the session belongs to a different user
        const ownerId = getCopilotSessionOwner(sessionId);
        if (ownerId && req.user && req.user.id !== ownerId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await sessionManager.deleteSession(sessionId);
        sessionNamesDb.deleteName(sessionId, 'copilot');
        removeCopilotSessionOwner(sessionId);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting Copilot session ${req.params.sessionId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
