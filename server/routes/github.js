import express from 'express';

import { projectsDb } from '../modules/database/index.js';
import * as ghService from '../modules/github/github.service.js';
import * as issuesService from '../modules/github/github-issues.service.js';
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
            const rawBody = req.rawBody;
            if (!rawBody) {
                return res.status(400).json({ error: 'Missing raw body for signature verification' });
            }
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

// GET /api/github/issues/:projectId — fetch all issues (cached 60s)
router.get('/issues/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const result = await issuesService.fetchIssues(projectPath);
        res.json({ ...result, columns: issuesService.COLUMNS });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/github/issues/:projectId/:issueNumber/comments
router.get('/issues/:projectId/:issueNumber/comments', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const comments = await issuesService.fetchComments(projectPath, req.params.issueNumber);
        res.json({ comments });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/github/issues/:projectId/:issueNumber — update state/labels/title
router.patch('/issues/:projectId/:issueNumber', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const updated = await issuesService.patchIssue(projectPath, req.params.issueNumber, req.body);
        res.json({ ok: true, issue: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/github/prioritize/:projectId — AI priority suggestions
// Accepts { issues: [{number, title, body, labels, state}] }
// Returns { priorities: [{number, priority, reason}] }
router.post('/prioritize/:projectId', async (req, res) => {
    try {
        const projectPath = await resolveProjectPathFromId(req.params.projectId);
        if (!projectPath) return res.status(404).json({ error: 'Project not found' });

        const { issues } = req.body;
        if (!Array.isArray(issues) || issues.length === 0) {
            return res.status(400).json({ error: 'issues array required' });
        }

        // Build a simple heuristic-based priority (no LLM needed):
        // high = bug/critical/security labels or words in title
        // medium = enhancement/feature
        // low = everything else
        const HIGH_SIGNALS = /\b(bug|crash|critical|security|broken|error|fail|urgent|blocker|regression)\b/i;
        const MEDIUM_SIGNALS = /\b(feature|enhancement|improve|add|implement|refactor)\b/i;

        const priorities = issues.map(issue => {
            const text = `${issue.title} ${issue.body ?? ''}`;
            const labelNames = (issue.labels ?? []).map(l => l.name ?? l).join(' ');
            const combined = `${text} ${labelNames}`;

            let priority = 'low';
            let reason = 'No strong signals detected';

            const bugLabel = (issue.labels ?? []).some(l => (l.name ?? l) === 'bug');
            if (bugLabel || HIGH_SIGNALS.test(combined)) {
                priority = 'high';
                reason = bugLabel ? 'Labeled as bug' : 'Contains urgency signal in title/body';
            } else if (MEDIUM_SIGNALS.test(combined)) {
                priority = 'medium';
                reason = 'Enhancement or feature request';
            }

            return { number: issue.number, priority, reason };
        });

        res.json({ priorities });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
