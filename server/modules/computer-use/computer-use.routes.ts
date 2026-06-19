import express from 'express';

import { computerUseService } from '@/modules/computer-use/computer-use.service.js';

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

function toButton(value: unknown): 'left' | 'right' | 'middle' {
  return value === 'right' || value === 'middle' ? value : 'left';
}

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, data: await computerUseService.getStatus() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Computer Use status.',
    });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json({ success: true, data: { settings: await computerUseService.getSettings() } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Computer Use settings.',
    });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await computerUseService.updateSettings(req.body || {});
    res.json({ success: true, data: { settings } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save Computer Use settings.',
    });
  }
});

router.post('/agent-tools/register', async (_req, res) => {
  try {
    const result = await computerUseService.registerAgentMcp();
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register Computer Use MCP.',
    });
  }
});

router.post('/runtime/install', async (_req, res) => {
  try {
    const result = await computerUseService.installRuntime();
    res.status(result.success ? 200 : 500).json({
      success: result.success,
      data: result,
      error: result.success ? undefined : result.message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install Computer Use runtime.',
    });
  }
});

router.get('/sessions', async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ success: true, data: { sessions: await computerUseService.listSessions(requireUser(req)) } });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list Computer Use sessions.',
    });
  }
});

router.post('/sessions', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.createSession(requireUser(req));
    res.status(session.status === 'unavailable' ? 202 : 201).json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Computer Use session.',
    });
  }
});

router.post('/sessions/:sessionId/screenshot', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.userScreenshot(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture the screen.',
    });
  }
});

router.post('/sessions/:sessionId/click', async (req: AuthenticatedRequest, res) => {
  try {
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({
        success: false,
        error: 'Valid numeric coordinates are required.',
      });
      return;
    }

    const session = await computerUseService.userClick(requireUser(req), readParam(req.params.sessionId), {
      x,
      y,
      button: toButton(req.body?.button),
      double: req.body?.double === true,
    });
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to click.',
    });
  }
});

router.post('/sessions/:sessionId/type', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.userType(requireUser(req), readParam(req.params.sessionId), String(req.body?.text || ''));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to type text.',
    });
  }
});

router.post('/sessions/:sessionId/press-key', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.userPressKey(requireUser(req), readParam(req.params.sessionId), String(req.body?.key || ''));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send key input.',
    });
  }
});

router.post('/sessions/:sessionId/consent/grant', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.grantAgentAccess(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to grant control.',
    });
  }
});

router.post('/sessions/:sessionId/consent/revoke', async (req: AuthenticatedRequest, res) => {
  try {
    const session = await computerUseService.revokeAgentAccess(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: { session } });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke control.',
    });
  }
});

router.post('/sessions/:sessionId/stop', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await computerUseService.stopSession(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop Computer Use session.',
    });
  }
});

router.delete('/sessions/:sessionId', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await computerUseService.deleteSession(requireUser(req), readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete Computer Use session.',
    });
  }
});

export default router;
