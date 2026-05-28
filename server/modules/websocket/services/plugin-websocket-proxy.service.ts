import { WebSocket } from 'ws';

/**
 * Proxies an authenticated client websocket to a plugin websocket endpoint.
 */
export function handlePluginWsProxy(
  clientWs: WebSocket,
  pathname: string,
  getPluginPort: (pluginName: string) => number | null
): void {
  const pluginName = pathname.replace('/plugin-ws/', '');
  if (!pluginName || /[^a-zA-Z0-9_-]/.test(pluginName)) {
    clientWs.close(4400, 'Invalid plugin name');
    return;
  }

  const port = getPluginPort(pluginName);
  if (!port) {
    clientWs.close(4404, 'Plugin not running');
    return;
  }

  const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`);

  upstream.on('open', () => {
    console.log(`[Plugins] WS proxy connected to "${pluginName}" on port ${port}`);
  });

  upstream.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  clientWs.on('message', (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });

  upstream.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  clientWs.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });

  upstream.on('error', (error) => {
    console.error(`[Plugins] WS proxy error for "${pluginName}":`, error.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4502, 'Upstream error');
    }
  });

  clientWs.on('error', () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}
