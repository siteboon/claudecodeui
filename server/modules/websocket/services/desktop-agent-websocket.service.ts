import type { WebSocket } from 'ws';

import { desktopAgentRelay } from '@/modules/computer-use/index.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

/**
 * Handles the `/desktop-agent` websocket — the inbound side of the cloud
 * Computer Use relay. A linked CloudCLI desktop app connects here and registers
 * itself as the executor for this hosted environment. The server then forwards
 * `computer_*` actions via `desktopAgentRelay`, and the agent returns results as
 * `computer_relay_result` frames correlated by `id`.
 */
export function handleDesktopAgentConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest
): void {
  const label = request.user?.username ? `desktop:${request.user.username}` : 'desktop-agent';
  console.log('[INFO] Desktop agent websocket connected:', label);
  desktopAgentRelay.register(ws, label);

  ws.on('message', (rawMessage) => {
    const data = parseIncomingJsonObject(rawMessage);
    if (!data) {
      return;
    }
    const kind = typeof data.kind === 'string' ? data.kind : typeof data.type === 'string' ? data.type : '';
    if (kind === 'computer_relay_result' && typeof data.id === 'string') {
      desktopAgentRelay.handleResult(
        data.id,
        (data as Record<string, unknown>).result,
        typeof (data as Record<string, unknown>).error === 'string'
          ? ((data as Record<string, unknown>).error as string)
          : undefined
      );
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Desktop agent websocket disconnected:', label);
  });
}
