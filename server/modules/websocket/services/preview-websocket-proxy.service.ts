import { WebSocket } from 'ws';

const PREVIEW_PREFIX_RE = /^\/preview\/(\d{1,5})(\/.*)?$/;

/**
 * Proxies a preview HMR / app websocket to the upstream dev server. The upgrade
 * request is authenticated in verifyWebSocketClient (via the preview cookie);
 * the target port is taken from the pathname.
 */
export function handlePreviewWsProxy(clientWs: WebSocket, pathname: string, search: string): void {
  const match = pathname.match(PREVIEW_PREFIX_RE);
  if (!match) {
    clientWs.close(4400, 'Invalid preview path');
    return;
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    clientWs.close(4400, 'Invalid preview port');
    return;
  }

  const upstreamPath = `${match[2] || '/'}${search || ''}`;
  const upstream = new WebSocket(`ws://127.0.0.1:${port}${upstreamPath}`);

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
  });
  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });
  upstream.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });
  clientWs.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
  upstream.on('error', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(4502, 'Upstream error');
  });
  clientWs.on('error', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}
