import express from 'express';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

const router = express.Router();

type AuthenticatedRequest = express.Request & {
  user?: {
    id?: string | number;
  };
};

function requireUser(req: AuthenticatedRequest): { id: string | number } {
  const userId = req.user?.id;
  if (userId === undefined || userId === null) {
    throw new Error('Authenticated user is required.');
  }
  return { id: userId };
}

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, data: await browserUseService.getStatus() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Browser Use status.',
    });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json({ success: true, data: { settings: await browserUseService.getSettings() } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Browser Use settings.',
    });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await browserUseService.updateSettings(req.body || {});
    res.json({ success: true, data: { settings } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save Browser Use settings.',
    });
  }
});

router.post('/agent-tools/register', async (_req, res) => {
  try {
    const result = await browserUseService.registerAgentMcp();
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register Browser Use MCP.',
    });
  }
});

router.post('/runtime/install', async (_req, res) => {
  try {
    const result = await browserUseService.installRuntime();
    res.status(result.success ? 200 : 500).json({
      success: result.success,
      data: result,
      error: result.success ? undefined : result.message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install Browser Use runtime.',
    });
  }
});

router.get('/sessions', async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ success: true, data: { sessions: await browserUseService.listSessions(requireUser(req)) } });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list browser sessions.',
    });
  }
});

router.post('/sessions', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await browserUseService.createSession(requireUser(req));
    res.status(session.status === 'unavailable' ? 202 : 201).json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create browser session.',
    });
  }
});

router.post('/sessions/:sessionId/navigate', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await browserUseService.navigate(requireUser(req), readParam(req.params.sessionId), String(req.body?.url || ''));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to navigate browser session.',
    });
  }
});

router.post('/sessions/:sessionId/agent-access/grant', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await browserUseService.grantAgentAccess(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to grant agent access.',
    });
  }
});

router.post('/sessions/:sessionId/agent-access/revoke', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await browserUseService.revokeAgentAccess(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke agent access.',
    });
  }
});

router.post('/sessions/:sessionId/stop', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await browserUseService.stopSession(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop browser session.',
    });
  }
});

export default router;
