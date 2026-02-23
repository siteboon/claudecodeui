import express from 'express';
import sessionManager from '../sessionManager.js';

const router = express.Router();

router.get('/sessions/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const messages = sessionManager.getSessionMessages(sessionId);

        res.json({
            success: true,
            messages: messages,
            total: messages.length,
            hasMore: false,
            offset: 0,
            limit: messages.length
        });
    } catch (error) {
        console.error('Error fetching Gemini session messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await sessionManager.deleteSession(sessionId);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting Gemini session ${req.params.sessionId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
