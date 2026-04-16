import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { sessionNamesDb } from '../database/db.js';

const router = express.Router();
const KIRO_SESSIONS_DIR = path.join(os.homedir(), '.kiro', 'sessions', 'cli');

router.delete('/sessions/:sessionId', async (req, res) => {
    // TODO: add per-user ownership check (see #574)
    // Note: gemini.js uses the same pattern without ownership checks — keeping consistent.
    try {
        const { sessionId } = req.params;

        if (!sessionId || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(sessionId)) {
            return res.status(400).json({ success: false, error: 'Invalid session ID format' });
        }

        const safeId = sessionId.replace(/[/\\]|\.\./g, '');
        const jsonlPath = path.join(KIRO_SESSIONS_DIR, `${safeId}.jsonl`);
        const jsonPath = path.join(KIRO_SESSIONS_DIR, `${safeId}.json`);

        let deleted = false;
        for (const filePath of [jsonlPath, jsonPath]) {
            try {
                await fs.unlink(filePath);
                deleted = true;
                break;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        sessionNamesDb.deleteName(sessionId, 'kiro');

        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Kiro session file not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error(`Error deleting Kiro session ${req.params.sessionId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
