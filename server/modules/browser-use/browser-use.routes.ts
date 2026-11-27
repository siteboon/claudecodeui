import express from 'express';
import type { Response } from 'express';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { AppError } from '@/shared/utils.js';

const router = express.Router();

/**
 * Stable machine-readable error codes for the browser-use API.
 *
 * The server always replies with the structured envelope used by AppError
 * (`{ success: false, error: { code, message, details } }`). Clients map
 * `code` to localized copy; `message` is an English fallback and `details`
 * may carry the underlying error text for diagnostics.
 */
export const BROWSER_USE_ERROR_CODES = {
  STATUS_LOAD_FAILED: 'BROWSER_USE_STATUS_LOAD_FAILED',
  SETTINGS_LOAD_FAILED: 'BROWSER_USE_SETTINGS_LOAD_FAILED',
  SETTINGS_SAVE_FAILED: 'BROWSER_USE_SETTINGS_SAVE_FAILED',
  RUNTIME_INSTALL_FAILED: 'BROWSER_USE_RUNTIME_INSTALL_FAILED',
  SESSIONS_LOAD_FAILED: 'BROWSER_USE_SESSIONS_LOAD_FAILED',
  SESSION_STOP_FAILED: 'BROWSER_USE_SESSION_STOP_FAILED',
  SESSION_DELETE_FAILED: 'BROWSER_USE_SESSION_DELETE_FAILED',
  SESSION_INPUT_FAILED: 'BROWSER_USE_SESSION_INPUT_FAILED',
  CONTROL_FAILED: 'BROWSER_USE_CONTROL_FAILED',
} as const;

function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
}

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, data: await browserUseService.getStatus() });
  } catch (error) {
    sendError(
      res,
      500,
      BROWSER_USE_ERROR_CODES.STATUS_LOAD_FAILED,
      'Failed to load Browser status.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json({ success: true, data: { settings: await browserUseService.getSettings() } });
  } catch (error) {
    sendError(
      res,
      500,
      BROWSER_USE_ERROR_CODES.SETTINGS_LOAD_FAILED,
      'Failed to load Browser settings.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await browserUseService.updateSettings(req.body || {});
    res.json({ success: true, data: { settings } });
  } catch (error) {
    sendError(
      res,
      400,
      BROWSER_USE_ERROR_CODES.SETTINGS_SAVE_FAILED,
      'Failed to save Browser settings.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.post('/runtime/install', async (_req, res) => {
  try {
    const result = await browserUseService.installRuntime();
    if (result.success) {
      res.json({ success: true, data: result });
      return;
    }
    sendError(
      res,
      500,
      BROWSER_USE_ERROR_CODES.RUNTIME_INSTALL_FAILED,
      'Failed to install Browser runtime.',
      result.message,
    );
  } catch (error) {
    sendError(
      res,
      500,
      BROWSER_USE_ERROR_CODES.RUNTIME_INSTALL_FAILED,
      'Failed to install Browser runtime.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.get('/sessions', async (_req, res) => {
  try {
    res.json({ success: true, data: { sessions: await browserUseService.listSessions() } });
  } catch (error) {
    sendError(
      res,
      401,
      BROWSER_USE_ERROR_CODES.SESSIONS_LOAD_FAILED,
      'Failed to list browser sessions.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.post('/sessions/:sessionId/stop', async (req, res) => {
  try {
    const result = await browserUseService.stopSession(readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    sendError(
      res,
      400,
      BROWSER_USE_ERROR_CODES.SESSION_STOP_FAILED,
      'Failed to stop browser session.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

router.post('/sessions/:sessionId/input', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    let input: Parameters<typeof browserUseService.userInput>[1];
    if (body.type === 'click' && Number.isFinite(body.x) && Number.isFinite(body.y)) {
      input = { type: 'click', x: Number(body.x), y: Number(body.y) };
    } else if (body.type === 'text' && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 2000) {
      input = { type: 'text', text: body.text };
    } else if (body.type === 'key' && typeof body.key === 'string' && body.key.length > 0 && body.key.length <= 32) {
      input = { type: 'key', key: body.key };
    } else {
      sendError(res, 400, BROWSER_USE_ERROR_CODES.SESSION_INPUT_FAILED, 'Invalid browser input.');
      return;
    }
    const session = await browserUseService.userInput(readParam(req.params.sessionId), input);
    res.json({ success: true, data: { session } });
  } catch (error) {
    sendError(
      res,
      400,
      BROWSER_USE_ERROR_CODES.SESSION_INPUT_FAILED,
      'Failed to send input to browser session.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function delta(value: unknown): value is number {
  return typeof value === 'number' && Math.abs(value) <= 2_000;
}

function readLiveInput(body: Record<string, unknown>): Parameters<typeof browserUseService.controlInput>[2] | null {
  if (body.type === 'text' && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 2_000) {
    return { type: 'text', text: body.text };
  }
  if (body.type === 'key' && typeof body.key === 'string' &&
      /^(?:(?:Control|Alt|Shift|Meta)\+)*(?:[a-z0-9]|Arrow(?:Up|Down|Left|Right)|Backspace|Delete|Enter|Tab|Home|End|PageUp|PageDown|Escape|Space)$/.test(body.key)
      && body.key.length <= 48) {
    return { type: 'key', key: body.key };
  }
  if (!coordinate(body.x) || !coordinate(body.y)) return null;
  if (body.type === 'wheel' && delta(body.dx) && delta(body.dy)) {
    return { type: 'wheel', x: body.x, y: body.y, dx: body.dx, dy: body.dy };
  }
  if (body.type === 'pointer') {
    if (body.to === undefined) return { type: 'pointer', x: body.x, y: body.y };
    const to = body.to as { x?: unknown; y?: unknown } | null;
    if (coordinate(to?.x) && coordinate(to?.y)) {
      return { type: 'pointer', x: body.x, y: body.y, to: { x: to.x, y: to.y } };
    }
  }
  return null;
}

router.post('/sessions/:sessionId/control/:action', async (req, res) => {
  const sessionId = readParam(req.params.sessionId);
  const action = readParam(req.params.action);
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (action === 'take') {
      res.json({ success: true, data: await browserUseService.takeControl(sessionId) });
      return;
    }
    if (typeof body.controlId === 'string' && /^[a-f0-9-]{36}$/.test(body.controlId)) {
      if (action === 'frame') {
        const screenshotDataUrl = await browserUseService.controlFrame(sessionId, body.controlId);
        res.json({ success: true, data: { screenshotDataUrl } });
        return;
      }
      if (action === 'release') {
        await browserUseService.releaseControl(sessionId, body.controlId);
        res.json({ success: true });
        return;
      }
      if (action === 'input') {
        const input = readLiveInput(body);
        if (input) {
          await browserUseService.controlInput(sessionId, body.controlId, input);
          res.json({ success: true });
          return;
        }
      }
    }
    sendError(res, 400, BROWSER_USE_ERROR_CODES.CONTROL_FAILED, 'Invalid browser control request.');
  } catch (error) {
    sendError(res, 409, error instanceof AppError ? error.code : BROWSER_USE_ERROR_CODES.CONTROL_FAILED,
      'Browser control is unavailable.', error instanceof Error ? error.message : undefined);
  }
});

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const result = await browserUseService.deleteSession(readParam(req.params.sessionId));
    res.json({ success: true, data: result });
  } catch (error) {
    sendError(
      res,
      400,
      BROWSER_USE_ERROR_CODES.SESSION_DELETE_FAILED,
      'Failed to delete browser session.',
      error instanceof Error ? error.message : undefined,
    );
  }
});

export default router;
