import { WebSocket } from 'ws';

import type {
  AuthenticatedWebSocketUser,
  PluginIdentityHeaders,
  PluginIdentityUser,
} from '@/shared/types.js';

type PluginWsProxyDependencies = {
  getPluginPort: (pluginName: string) => number | null;
  // Same signer the HTTP RPC route uses, so plugins verify both transports alike.
  buildIdentityHeaders: (pluginName: string, user: PluginIdentityUser | undefined) => PluginIdentityHeaders;
};

/**
 * Proxies an authenticated client websocket to a plugin websocket endpoint,
 * attaching the signed x-plugin-user-* identity headers to the upstream upgrade.
 * Used by websocket-server.service for the /plugin-ws/:name route.
 */
export function handlePluginWsProxy(
  clientWs: WebSocket,
  pathname: string,
  user: AuthenticatedWebSocketUser | undefined,
  { getPluginPort, buildIdentityHeaders }: PluginWsProxyDependencies,
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

  // Identity is computed per upgrade; the client's own headers are never forwarded.
  const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`, [], {
    headers: buildIdentityHeaders(pluginName, user),
  });

  upstream.on('open', () => {
    console.log(`[Plugins] WS proxy connected to "${pluginName}" on port ${port}`);
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
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
