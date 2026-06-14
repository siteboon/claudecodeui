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

router.get('/status', (_req, res) => {
  res.json({ success: true, data: browserUseService.getStatus() });
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
