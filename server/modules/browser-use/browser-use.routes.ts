import express from 'express';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { VIEWER_COOKIE_NAME, VIEWER_TOKEN_TTL_MS } from '@/modules/browser-use/browser-use.viewer.js';

const router = express.Router();

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

const SAFE_VIEWER_ROOT_FILES = new Set(['vnc.html', 'favicon.ico', 'manifest.json']);
const SAFE_VIEWER_ROOT_DIRS = new Set(['app', 'core', 'vendor', 'assets', 'images', 'utils']);

function isSafeViewerPath(viewerPath: string): boolean {
  if (!viewerPath || viewerPath.startsWith('/') || viewerPath.includes('..') || viewerPath.includes('\\')) {
    return false;
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(viewerPath)) {
    return false;
  }

  if (SAFE_VIEWER_ROOT_FILES.has(viewerPath)) {
    return true;
  }

  const [rootDir] = viewerPath.split('/');
  return Boolean(rootDir && SAFE_VIEWER_ROOT_DIRS.has(rootDir));
}

function isSecureRequest(req: express.Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

function readQueryString(originalUrl: string): string {
  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex < 0) {
    return '';
  }
  const params = new URLSearchParams(originalUrl.slice(queryIndex + 1));
  params.delete('viewerToken');
  const nextQuery = params.toString();
  return nextQuery ? `?${nextQuery}` : '';
}

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, data: await browserUseService.getStatus() });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Browser status.',
    });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json({ success: true, data: { settings: await browserUseService.getSettings() } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load Browser settings.',
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
      error: error instanceof Error ? error.message : 'Failed to save Browser settings.',
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
      error: error instanceof Error ? error.message : 'Failed to install Browser runtime.',
    });
  }
});

router.get('/sessions', async (_req, res) => {
  try {
    res.json({ success: true, data: { sessions: await browserUseService.listSessions() } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list browser sessions.',
    });
  }
});

router.get('/sessions/:sessionId/viewer/*', async (req, res) => {
  try {
    const sessionId = readParam(req.params.sessionId);
    const originalPath = req.originalUrl.split('?')[0] || '';
    const viewerMarker = `/sessions/${sessionId}/viewer/`;
    const markerIndex = originalPath.indexOf(viewerMarker);
    const rawViewerPath = markerIndex >= 0 ? originalPath.slice(markerIndex + viewerMarker.length) : 'vnc.html';
    const viewerPath = decodeURIComponent(rawViewerPath).replace(/^\/+/, '') || 'vnc.html';
    if (!isSafeViewerPath(viewerPath)) {
      res.status(400).json({ success: false, error: 'Invalid Browser viewer path.' });
      return;
    }

    const viewerToken = readParam(req.query.viewerToken as string | string[] | undefined);
    if (viewerPath === 'vnc.html' && browserUseService.validateViewerToken(sessionId, viewerToken)) {
      res.cookie(VIEWER_COOKIE_NAME, viewerToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(req),
        maxAge: VIEWER_TOKEN_TTL_MS,
        path: '/api/browser-use/sessions/' + encodeURIComponent(sessionId) + '/viewer',
      });
    }
    const target = browserUseService.getViewerProxyTarget(sessionId);
    const query = readQueryString(req.originalUrl);
    const upstream = await fetch(`http://127.0.0.1:${target.websockifyPort}/${viewerPath}${query}`, {
      headers: {
        accept: String(req.headers.accept || '*/*'),
      },
    });
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    const cacheControl = viewerPath === 'vnc.html' ? 'no-store' : 'public, max-age=3600';
    res.setHeader('cache-control', cacheControl);
    res.status(upstream.status);
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error instanceof Error ? error.message : 'Browser viewer is not available.',
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
