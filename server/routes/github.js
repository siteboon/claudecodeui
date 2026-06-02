import express from 'express';

import { projectsDb } from '../modules/database/index.js';
import * as ghService from '../modules/github/github.service.js';
import * as syncService from '../modules/github/github-sync.service.js';
import { broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';

const router = express.Router();

async function resolveProjectPathFromId(projectId) {
    if (!projectId) return null;
    return projectsDb.getProjectPathById(projectId);
}

// GET /api/github/config/:projectId — returns config with token redacted
router.get('/config/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const config = await syncService.readSyncConfig(projectPath);
        if (!config) return res.json({ configured: false });

        res.json({
            configured: true,
            enabled: config.enabled,
            owner: config.owner,
            repo: config.repo,
            hasToken: Boolean(config.token),
            hasWebhookSecret: Boolean(config.webhookSecret),
            lastSync: config.lastSync || null,
            taskCount: Object.keys(config.tasks || {}).length,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/github/config/:projectId — save config
router.put('/config/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const { owner, repo, token, webhookSecret, enabled } = req.body;
        if (!owner || !repo || !token) {
            return res.status(400).json({ error: 'owner, repo, and token are required' });
        }

        const existing = await syncService.readSyncConfig(projectPath) || {};
        const updated = {
            ...existing,
            owner,
            repo,
            token,
            webhookSecret: webhookSecret || existing.webhookSecret || '',
            enabled: enabled !== undefined ? enabled : (existing.enabled ?? true),
        };

        await syncService.writeSyncConfig(projectPath, updated);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/github/config/:projectId — disable / clear config
router.delete('/config/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const existing = await syncService.readSyncConfig(projectPath);
        if (existing) {
            await syncService.writeSyncConfig(projectPath, { ...existing, enabled: false, token: '', webhookSecret: '' });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/github/test/:projectId — test connection
router.post('/test/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const { owner, repo, token } = req.body;
        if (!owner || !repo || !token) {
            return res.status(400).json({ error: 'owner, repo, token required' });
        }

        const repoData = await ghService.testConnection(token, owner, repo);
        res.json({ ok: true, repoFullName: repoData.full_name, private: repoData.private });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// POST /api/github/sync/:projectId — full push sync
router.post('/sync/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const results = await syncService.fullSyncToGitHub(projectPath);
        res.json({ ok: true, synced: results.length, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/github/webhook/:projectId — receive GitHub webhooks
// Must read raw body for HMAC verification — use express.raw() in mount
router.post('/webhook/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const config = await syncService.readSyncConfig(projectPath);
        if (!config?.enabled) return res.status(200).json({ skipped: 'sync disabled' });

        // Verify webhook signature if secret configured
        if (config.webhookSecret) {
            const sig = req.headers['x-hub-signature-256'];
            const rawBody = req.rawBody || JSON.stringify(req.body);
            if (!ghService.verifyWebhookSignature(config.webhookSecret, rawBody, sig)) {
                return res.status(401).json({ error: 'Invalid webhook signature' });
            }
        }

        // Respond immediately — process async
        res.status(202).json({ accepted: true });

        const event = req.headers['x-github-event'];
        const payload = req.body;

        if (event !== 'issues') return;

        const { action, issue } = payload;
        const issueNumber = issue?.number;
        if (!issueNumber) return;

        if (['closed', 'reopened', 'labeled', 'unlabeled'].includes(action)) {
            await syncService.applyIssueToTask(
                projectPath,
                issueNumber,
                issue,
                req.app.locals.wss,
                req.params.projectId,
                broadcastTaskMasterTasksUpdate
            ).catch(e => console.error('[GitHub Webhook] applyIssueToTask:', e.message));
        }
    } catch (err) {
        console.error('[GitHub Webhook] error:', err.message);
        // Already sent 202, nothing to do
    }
});

export default router;
