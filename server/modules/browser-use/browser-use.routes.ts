import express from 'express';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

const router = express.Router();

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

router.get('/sessions', async (_req, res) => {
  try {
    res.json({ success: true, data: { sessions: await browserUseService.listSessions() } });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list browser sessions.',
    });
  }
});

router.post('/sessions/:sessionId/stop', async (req, res) => {
  try {
    const result = await browserUseService.stopSession(readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop browser session.',
    });
  }
});

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const result = await browserUseService.deleteSession(readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete browser session.',
    });
  }
});

export default router;
