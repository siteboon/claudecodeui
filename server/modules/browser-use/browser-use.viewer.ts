import { WebSocket } from 'ws';

import type { RuntimeHandle } from './browser-use.types.js';

type BrowserUseViewer = NonNullable<RuntimeHandle['viewer']>;

export const VIEWER_COOKIE_NAME = 'browser_use_viewer_token';
export const VIEWER_TOKEN_TTL_MS = Number.parseInt(
  process.env.CLOUDCLI_BROWSER_USE_VIEWER_TOKEN_TTL_MS || String(30 * 60 * 1000),
  10,
);

export function getViewerUrl(sessionId: string, viewerToken?: string): string {
  const basePath = `/api/browser-use/sessions/${encodeURIComponent(sessionId)}/viewer`;
  const websockifyPath = viewerToken
    ? `${basePath}/websockify?viewerToken=${encodeURIComponent(viewerToken)}`
    : `${basePath}/websockify`;
  const params = new URLSearchParams({
    autoconnect: '1',
    resize: 'scale',
    reconnect: '1',
    path: websockifyPath,
  });
  if (viewerToken) {
    params.set('viewerToken', viewerToken);
  }
  return `${basePath}/vnc.html?${params.toString()}`;
}

export function handleViewerWebSocket(
  clientWs: WebSocket,
  pathname: string,
  getSessionViewer: (sessionId: string) => BrowserUseViewer | null | undefined,
) {
  const match = /^\/api\/browser-use\/sessions\/([^/]+)\/viewer\/websockify\/?$/.exec(pathname);
  const sessionId = match ? decodeURIComponent(match[1]) : '';
  const viewer = sessionId ? getSessionViewer(sessionId) : null;
  if (!viewer) {
    clientWs.close(4404, 'Browser viewer not found');
    return;
  }

  const upstream = new WebSocket(`ws://127.0.0.1:${viewer.websockifyPort}`);
  upstream.on('open', () => {
    clientWs.on('message', (data) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data);
      }
    });
    upstream.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });
  });
  upstream.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason);
    }
  });
  upstream.on('error', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4502, 'Browser viewer upstream error');
    }
  });
  clientWs.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}
